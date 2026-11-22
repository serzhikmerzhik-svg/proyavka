/**
 * Озвучка текста дня (SPEC §8): POST /api/tts → mp3.
 * По умолчанию — OpenAI gpt-4o-mini-tts: стиль из recipe.voice уходит в `instructions`, скорость — из рецепта.
 * Провайдер за интерфейсом: Yandex SpeechKit (русский и казахский) подключается сюда же.
 */
import type { Request, Response } from 'express';
import OpenAI from 'openai';
import { z } from 'zod';

export const TtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(20000),
  style: z.string().max(600).default(''),
  speed: z.number().min(0.5).max(2).default(1),
  /** атмосфера дня — для выбора голоса */
  mood: z.object({ energy: z.number().min(0).max(1), tone: z.number().min(0).max(1) }).optional(),
});
export type TtsRequest = z.infer<typeof TtsRequestSchema>;

export interface TtsProvider {
  readonly id: 'openai' | 'yandex';
  readonly model: string;
  synthesize(req: TtsRequest): Promise<Buffer>;
}

/** Голос под атмосферу: тихо и светло — мягкий, интенсивно — собранный, иначе тёплый. */
export function voiceFor(mood?: { energy: number; tone: number }): string {
  if (!mood) return 'coral';
  if (mood.energy < 0.4) return mood.tone >= 0.5 ? 'sage' : 'ballad';
  if (mood.energy >= 0.7) return mood.tone >= 0.5 ? 'verse' : 'ash';
  return 'coral';
}

/** У OpenAI TTS предел 4096 символов на запрос — режем по предложениям, mp3-куски склеиваются. */
export function splitForTts(text: string, limit = 3800): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/u);
  const parts: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > limit) {
      if (cur) parts.push(cur);
      for (let i = 0; i < s.length; i += limit) parts.push(s.slice(i, i + limit));
      cur = '';
    } else if ((cur ? cur.length + 1 : 0) + s.length > limit) {
      parts.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

export function createOpenAITts(env: NodeJS.ProcessEnv = process.env): TtsProvider {
  // если модель игнорирует instructions — зафиксируйте снимок через TTS_MODEL (SPEC §8)
  const model = env.TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
  const fixedVoice = env.OPENAI_TTS_VOICE?.trim();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY?.trim() || undefined, timeout: 60_000, maxRetries: 1 });
  return {
    id: 'openai',
    model,
    async synthesize(req) {
      const chunks: Buffer[] = [];
      for (const input of splitForTts(req.text)) {
        const res = await client.audio.speech.create({
          model,
          voice: fixedVoice || voiceFor(req.mood),
          input,
          instructions: req.style || undefined,
          speed: req.speed,
          response_format: 'mp3',
        });
        chunks.push(Buffer.from(await res.arrayBuffer()));
      }
      return Buffer.concat(chunks);
    },
  };
}

export type TtsChoice = { provider: TtsProvider; reason?: undefined } | { provider: null; reason: string };

/** TTS_PROVIDER = openai | yandex | none; не задан — OpenAI, если есть ключ. */
export function resolveTts(env: NodeJS.ProcessEnv = process.env): TtsChoice {
  const explicit = env.TTS_PROVIDER?.trim().toLowerCase();
  const choice = explicit || (env.OPENAI_API_KEY?.trim() ? 'openai' : 'none');
  if (choice === 'none') return { provider: null, reason: explicit ? 'TTS_PROVIDER=none' : 'ключ для озвучки не задан' };
  if (choice === 'yandex') {
    // TODO: Yandex SpeechKit (ru-RU, kk-KZ) — реализовать TtsProvider с API-ключом сервисного аккаунта
    return { provider: null, reason: 'Yandex SpeechKit ещё не подключён' };
  }
  if (choice !== 'openai') return { provider: null, reason: `неизвестный TTS_PROVIDER «${choice}»` };
  try {
    return { provider: createOpenAITts(env) };
  } catch (e) {
    return { provider: null, reason: `openai: ${(e as Error).message}` };
  }
}

let cached: TtsChoice | null = null;
export const getTts = () => (cached ??= resolveTts());

export async function ttsHandler(req: Request, res: Response) {
  const parsed = TtsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректный запрос', issues: parsed.error.issues.slice(0, 5) });
    return;
  }
  const { provider, reason } = getTts();
  if (!provider) {
    res.status(503).json({ error: `Озвучка выключена: ${reason}` });
    return;
  }
  try {
    const mp3 = await provider.synthesize(parsed.data);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-TTS-Provider', `${provider.id}/${provider.model}`);
    res.send(mp3);
  } catch (e) {
    // текст дня в логи не пишем
    const status = e instanceof OpenAI.APIError && typeof e.status === 'number' ? e.status : undefined;
    console.warn(`[tts] ${provider.id}: ${status ?? ''} ${(e as Error).message}`);
    res.status(502).json({ error: `Озвучка не удалась${status ? ` (${status})` : ''}` });
  }
}
