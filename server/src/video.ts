/**
 * ИИ-оживление кадра через видео-API — ОТДЕЛЬНАЯ ОПЦИЯ, по умолчанию выключена.
 * Это сознательное исключение из SPEC §9 («не генерируем изображения нейросетью»): включается только
 * явным VIDEO_PROVIDER=kling с ключами, в интерфейсе спрашивает подтверждение, результат помечается.
 *
 * Kling image-to-video: POST /v1/videos/image2video → task_id; GET …/{task_id} → task_status
 * (submitted | processing | succeed | failed) и task_result.videos[0].url. Авторизация — JWT HS256:
 * iss = Access Key, подпись Secret Key, срок ~30 минут, nbf на 5 с в прошлом.
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AIRS } from './types.js';

export type VideoState = 'queued' | 'running' | 'done' | 'failed';
export type VideoStatus = { state: VideoState; videoUrl?: string; error?: string };

export interface VideoProvider {
  readonly id: 'kling';
  readonly model: string;
  create(imageBase64: string, prompt: string, negativePrompt: string): Promise<string>;
  status(taskId: string): Promise<VideoStatus>;
}

export class VideoError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

// ---------- запрос и промпт ----------
export const AnimateRequestSchema = z.object({
  /** кадр дня: JPEG в base64 без префикса data: (у Kling предел 10 МБ) */
  image: z.string().min(100).max(14_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'ожидается base64'),
  /** частицы воздуха из рецепта — что именно должно двигаться */
  air: z.array(z.enum(AIRS)).default([]),
});

const MOTION: Record<(typeof AIRS)[number], string> = {
  steam: 'thin steam slowly rising from hot drinks',
  leaves: 'leaves gently trembling and a few drifting down in a light breeze',
  snow: 'light snowflakes softly falling',
  rain: 'raindrops running down and quietly falling',
  dust: 'dust motes floating in the light',
  fog: 'mist slowly drifting',
};

/** Синемаграф: кадр и камера неподвижны, едва заметно двигаются только детали. */
export function buildMotionPrompt(air: readonly (typeof AIRS)[number][]): { prompt: string; negative: string } {
  const details = air.length ? air.map((a) => MOTION[a]).join('; ') : 'hair, fabric and foliage barely moving in a light breeze, light softly flickering';
  return {
    prompt:
      `Cinemagraph of this exact photo. Static locked-off camera, same framing, same people and objects. ` +
      `Only small natural details move subtly: ${details}. Calm, realistic, no new elements.`,
    negative: 'camera movement, zoom, pan, new people, new objects, morphing, distorted faces, scene change, text, watermark',
  };
}

// ---------- Kling ----------
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function klingJwt(accessKey: string, secretKey: string, nowSec = Date.now() / 1000): string {
  const now = Math.floor(nowSec);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const sig = crypto.createHmac('sha256', secretKey).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

type KlingEnvelope = {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_status_msg?: string;
    task_result?: { videos?: { id?: string; url?: string; duration?: string }[] };
  };
};

const STATE: Record<string, VideoState> = { submitted: 'queued', processing: 'running', succeed: 'done', failed: 'failed' };

export function createKling(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): VideoProvider {
  const accessKey = env.KLING_ACCESS_KEY?.trim();
  const secretKey = env.KLING_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) throw new Error('нужны KLING_ACCESS_KEY и KLING_SECRET_KEY');
  const base = (env.KLING_BASE_URL?.trim() || 'https://api.klingai.com').replace(/\/+$/, '');
  const model = env.KLING_MODEL?.trim() || 'kling-v2-6';
  const mode = env.KLING_MODE?.trim() === 'pro' ? 'pro' : 'std';

  const call = async (path: string, init?: RequestInit): Promise<KlingEnvelope> => {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${klingJwt(accessKey, secretKey)}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => null)) as KlingEnvelope | null;
    if (res.status === 401 || res.status === 403) throw new VideoError('Kling: нет доступа — проверьте ключи', 502);
    if (res.status === 429) throw new VideoError('Kling: лимит запросов или параллельных задач, попробуйте позже', 429);
    if (!res.ok || !json || json.code !== 0) {
      throw new VideoError(`Kling: ${json?.message ?? `ошибка ${res.status}`}`, 502);
    }
    return json;
  };

  return {
    id: 'kling',
    model,
    async create(image, prompt, negative) {
      const json = await call('/v1/videos/image2video', {
        method: 'POST',
        body: JSON.stringify({ model_name: model, image, prompt, negative_prompt: negative, mode, duration: '5' }),
      });
      const id = json.data?.task_id;
      if (!id) throw new VideoError('Kling: в ответе нет task_id', 502);
      return id;
    },
    async status(taskId) {
      const json = await call(`/v1/videos/image2video/${encodeURIComponent(taskId)}`);
      const state = STATE[json.data?.task_status ?? ''] ?? 'running';
      if (state === 'done') {
        const url = json.data?.task_result?.videos?.[0]?.url;
        return url ? { state, videoUrl: url } : { state: 'failed', error: 'Kling: задача готова, но ссылки на видео нет' };
      }
      if (state === 'failed') return { state, error: json.data?.task_status_msg || json.message || 'генерация не удалась' };
      return { state };
    },
  };
}

// ---------- выбор провайдера ----------
export type VideoChoice = { provider: VideoProvider; reason?: undefined } | { provider: null; reason: string };

/** Только явное VIDEO_PROVIDER=kling: ключи сами по себе опцию не включают. */
export function resolveVideo(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): VideoChoice {
  const choice = env.VIDEO_PROVIDER?.trim().toLowerCase() || 'none';
  if (choice === 'none') return { provider: null, reason: 'ИИ-оживление выключено (VIDEO_PROVIDER не задан)' };
  if (choice !== 'kling') return { provider: null, reason: `неизвестный VIDEO_PROVIDER «${choice}»` };
  try {
    return { provider: createKling(env, fetchImpl) };
  } catch (e) {
    return { provider: null, reason: `kling: ${(e as Error).message}` };
  }
}

let cached: VideoChoice | null = null;
export const getVideo = () => (cached ??= resolveVideo());

// ---------- маршруты ----------
const TASK_ID = /^[\w-]{4,128}$/;

function fail(res: Response, e: unknown) {
  const status = e instanceof VideoError ? e.httpStatus : 502;
  console.warn(`[animate] ${(e as Error).message}`);
  res.status(status).json({ error: (e as Error).message });
}

/** POST /api/animate { image, air } → { taskId } */
export async function animateCreateHandler(req: Request, res: Response) {
  const { provider, reason } = getVideo();
  if (!provider) {
    res.status(503).json({ error: reason });
    return;
  }
  const parsed = AnimateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректный запрос', issues: parsed.error.issues.slice(0, 3) });
    return;
  }
  try {
    const { prompt, negative } = buildMotionPrompt(parsed.data.air);
    const taskId = await provider.create(parsed.data.image, prompt, negative);
    res.json({ taskId, provider: provider.id, model: provider.model });
  } catch (e) {
    fail(res, e);
  }
}

/** GET /api/animate/:taskId → { state, error? } (ссылку провайдера наружу не отдаём) */
export async function animateStatusHandler(req: Request, res: Response) {
  const { provider, reason } = getVideo();
  if (!provider) {
    res.status(503).json({ error: reason });
    return;
  }
  const taskId = String(req.params.taskId);
  if (!TASK_ID.test(taskId)) {
    res.status(400).json({ error: 'Некорректный task_id' });
    return;
  }
  try {
    const s = await provider.status(taskId);
    res.json({ state: s.state, error: s.error });
  } catch (e) {
    fail(res, e);
  }
}

/** GET /api/animate/:taskId/video → mp4 (ссылки провайдера короткоживущие — забираем сразу) */
export async function animateVideoHandler(req: Request, res: Response) {
  const { provider, reason } = getVideo();
  if (!provider) {
    res.status(503).json({ error: reason });
    return;
  }
  const taskId = String(req.params.taskId);
  if (!TASK_ID.test(taskId)) {
    res.status(400).json({ error: 'Некорректный task_id' });
    return;
  }
  try {
    const s = await provider.status(taskId);
    if (s.state !== 'done' || !s.videoUrl) {
      res.status(409).json({ error: 'Видео ещё не готово', state: s.state });
      return;
    }
    if (!s.videoUrl.startsWith('https://')) throw new VideoError('Kling вернул небезопасную ссылку', 502);
    const upstream = await fetch(s.videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!upstream.ok || !upstream.body) throw new VideoError(`Видео недоступно (${upstream.status})`, 502);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    Readable.fromWeb(upstream.body as unknown as WebReadableStream).pipe(res);
  } catch (e) {
    if (!res.headersSent) fail(res, e);
    else res.end();
  }
}
