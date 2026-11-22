/**
 * Озвучка дня (SPEC §8): сервер синтезирует mp3 со стилем и скоростью из recipe.voice,
 * mp3 сохраняется в дне. Без ключа сервер отвечает 503 — озвучки просто нет (демо-режим).
 */
import { getDay, updateDay } from '../storage/db';

export type VoiceEvent =
  | { type: 'ready'; dayId: string }
  | { type: 'unavailable'; dayId: string; reason: string }
  | { type: 'error'; dayId: string; error: string };

const listeners = new Set<(e: VoiceEvent) => void>();
const running = new Set<string>();
let unavailable: string | null = null; // сервер уже сказал «озвучка выключена» — не спрашиваем снова

export function onVoice(listener: (e: VoiceEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const emit = (e: VoiceEvent) => listeners.forEach((l) => l(e));

export async function addVoiceToDay(dayId: string): Promise<void> {
  if (running.has(dayId)) return;
  if (unavailable) {
    emit({ type: 'unavailable', dayId, reason: unavailable });
    return;
  }
  running.add(dayId);
  try {
    const day = await getDay(dayId);
    if (!day || day.voice) return;
    const { energy, tone } = day.recipe.atmosphere;
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: day.text, style: day.recipe.voice.style, speed: day.recipe.voice.speed, mood: { energy, tone } }),
    }).catch(() => null);
    // 503 — ключа нет; 404/405 или сеть — сервера нет вовсе (статичный хостинг)
    if (!res || res.status === 503 || res.status === 404 || res.status === 405) {
      const err = res && ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
      unavailable = err || 'озвучка работает только вместе с сервером';
      emit({ type: 'unavailable', dayId, reason: unavailable });
      return;
    }
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
    const voice = await res.blob();
    if (!(await getDay(dayId))) return; // день удалили, пока синтезировали
    await updateDay(dayId, { voice });
    emit({ type: 'ready', dayId });
  } catch (e) {
    emit({ type: 'error', dayId, error: (e as Error).message });
  } finally {
    running.delete(dayId);
  }
}
