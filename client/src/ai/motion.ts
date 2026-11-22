/**
 * ИИ-оживление кадра дня — отдельная опция (на сервере выключена, пока не задан VIDEO_PROVIDER=kling).
 * Кадр дня уходит через наш сервер в видео-API, через 1–5 минут возвращается синемаграф: камера
 * неподвижна, едва двигаются детали. Видео хранится в дне и после проявки подменяет кадр в шейдере.
 * Везде, где оно видно (отпечаток, запись проявки, папка дня), стоит пометка «ИИ-оживление».
 * Опрос живёт на уровне модуля: можно уйти с экрана — видео всё равно сохранится в день.
 */
import { getDay, updateDay } from '../storage/db';
import { loadVideo, unloadVideo } from '../render/video';
import type { Day } from '../recipe/types';

export type MotionInfo = NonNullable<Day['motion']>;
export type MotionStage = 'upload' | 'queued' | 'running' | 'download';
export type MotionProgress = { type: 'progress'; dayId: string; stage: MotionStage; startedAt: number };
export type MotionEvent = MotionProgress | { type: 'ready'; dayId: string } | { type: 'error'; dayId: string; error: string };
export type MotionAvailability = { enabled: true; provider: string; model: string } | { enabled: false; reason: string };

export const MOTION_LABEL = 'ИИ-оживление';
export const STAGE_RU: Record<MotionStage, string> = {
  upload: 'отправляю кадр',
  queued: 'в очереди',
  running: 'оживляю',
  download: 'забираю видео',
};
export const providerName = (id: string) => (id === 'kling' ? 'Kling' : id);

const POLL_MS = 5000;
const GIVE_UP_MS = 15 * 60_000;
const MAX_POLL_ERRORS = 3;
/** длинная сторона кадра для видео-API: хватает для 720p/1080p и далеко до предела в 10 МБ */
const MAX_SIDE = 1600;

const listeners = new Set<(e: MotionEvent) => void>();
const progress = new Map<string, MotionProgress>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function onMotion(listener: (e: MotionEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const emit = (e: MotionEvent) => {
  if (e.type === 'progress') progress.set(e.dayId, e);
  else progress.delete(e.dayId);
  listeners.forEach((l) => l(e));
};

/** Идёт ли сейчас оживление дня — экран, открытый заново, покажет прогресс. */
export const motionProgress = (dayId: string): MotionProgress | undefined => progress.get(dayId);

let availability: Promise<MotionAvailability> | null = null;
/** Включено ли оживление на сервере (/api/health). Без сервера (статичный хостинг) — выключено. */
export function motionAvailability(): Promise<MotionAvailability> {
  availability ??= fetch('/api/health')
    .then(async (r): Promise<MotionAvailability> => {
      if (!r.ok) throw new Error(`сервер ответил ${r.status}`);
      const h = (await r.json()) as { video?: { provider: string; model: string } | null; videoReason?: string };
      return h.video ? { enabled: true, ...h.video } : { enabled: false, reason: h.videoReason ?? 'ИИ-оживление выключено' };
    })
    .catch((): MotionAvailability => ({ enabled: false, reason: 'сервер недоступен' }))
    .then((a) => {
      if (!a.enabled) availability = null; // выключено — при следующем нажатии спросим сервер снова
      return a;
    });
  return availability;
}

async function jpegBase64(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('кадр не сжался'))), 'image/jpeg', 0.9),
  );
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error ?? `сервер ответил ${res.status}`);
  return json;
}

const running = new Set<string>();

/** Оживить кадр дня. Согласие пользователя спрашивает экран — сюда приходим уже с ним. */
export async function animateDay(dayId: string): Promise<void> {
  if (running.has(dayId)) return;
  running.add(dayId);
  const startedAt = Date.now();
  const stage = (s: MotionStage) => emit({ type: 'progress', dayId, stage: s, startedAt });
  try {
    const day = await getDay(dayId);
    if (!day) throw new Error('день не найден');
    const photoIndex = Math.max(0, Math.min(day.recipe.bestPhotoIndex, day.photos.length - 1));
    stage('upload');
    const image = await jpegBase64(day.photos[photoIndex].blob);
    const task = await api<{ taskId: string; provider: string; model: string }>('/api/animate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, air: day.recipe.air.particles }),
    });
    stage('queued');

    let pollErrors = 0;
    for (;;) {
      if (Date.now() - startedAt > GIVE_UP_MS) throw new Error('генерация идёт слишком долго — попробуйте позже');
      await sleep(POLL_MS);
      let s: { state: 'queued' | 'running' | 'done' | 'failed'; error?: string };
      try {
        s = await api(`/api/animate/${encodeURIComponent(task.taskId)}`);
        pollErrors = 0;
      } catch (e) {
        if (++pollErrors >= MAX_POLL_ERRORS) throw e; // одна-две сетевые осечки — не повод бросать задачу
        continue;
      }
      if (s.state === 'failed') throw new Error(s.error ?? 'генерация не удалась');
      if (s.state === 'done') break;
      stage(s.state);
    }

    stage('download');
    const res = await fetch(`/api/animate/${encodeURIComponent(task.taskId)}/video`);
    if (!res.ok) {
      const err = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
      throw new Error(err ?? `видео не скачалось (${res.status})`);
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error('пришло пустое видео');
    unloadVideo(await loadVideo(blob)); // битое видео в день не сохраняем
    if (!(await getDay(dayId))) {
      progress.delete(dayId); // день удалили, пока оживляли
      return;
    }
    const motion: MotionInfo = { blob, photoIndex, provider: task.provider, model: task.model, createdAt: Date.now() };
    await updateDay(dayId, { motion });
    emit({ type: 'ready', dayId });
  } catch (e) {
    emit({ type: 'error', dayId, error: (e as Error).message });
  } finally {
    running.delete(dayId);
  }
}
