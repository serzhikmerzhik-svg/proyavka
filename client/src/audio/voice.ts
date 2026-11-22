/**
 * Озвучка дня (SPEC §8): сервер синтезирует mp3 со стилем и скоростью из recipe.voice (нужен ключ).
 * Без ключа или без сервера (GitHub Pages) — мягкий человеческий голос прямо на устройстве (Piper, «Ирина»).
 * Голос сохраняется в дне, звучит через тот же граф Web Audio и попадает в запись видео.
 */
import { getDay, updateDay } from '../storage/db';
import { synthesizeOnDevice } from './piper';
import type { Recipe } from '../recipe/types';

export type VoiceEvent =
  | { type: 'progress'; dayId: string; progress: number }
  | { type: 'ready'; dayId: string }
  | { type: 'unavailable'; dayId: string; reason: string }
  | { type: 'error'; dayId: string; error: string };

const listeners = new Set<(e: VoiceEvent) => void>();
const running = new Set<string>();
let serverOff: string | null = null; // сервер уже сказал «озвучки нет» — сразу голос на устройстве
let deviceOff: string | null = null; // и голос на устройстве не запустился — озвучки нет совсем

export function onVoice(listener: (e: VoiceEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const emit = (e: VoiceEvent) => listeners.forEach((l) => l(e));

export async function addVoiceToDay(dayId: string): Promise<void> {
  if (running.has(dayId)) return;
  if (deviceOff) {
    emit({ type: 'unavailable', dayId, reason: deviceOff });
    return;
  }
  running.add(dayId);
  try {
    const day = await getDay(dayId);
    if (!day || day.voice) return;
    let voice: Blob | null = null;
    if (!serverOff) {
      const { energy, tone } = day.recipe.atmosphere;
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: day.text, style: day.recipe.voice.style, speed: day.recipe.voice.speed, mood: { energy, tone } }),
      }).catch(() => null);
      if (res?.ok) voice = await res.blob();
      // 503 — ключа нет; 404/405 или сеть — сервера нет вовсе (статичный хостинг)
      else if (!res || res.status === 503 || res.status === 404 || res.status === 405) {
        const err = res && ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
        serverOff = err || 'нет сервера озвучки';
      } else throw new Error(`сервер ответил ${res.status}`);
    }
    if (!voice) {
      try {
        emit({ type: 'progress', dayId, progress: 0 });
        voice = await synthesizeOnDevice(day.text, (progress) => emit({ type: 'progress', dayId, progress }));
      } catch (e) {
        deviceOff = `${serverOff ?? 'озвучка недоступна'}; голос на устройстве не запустился (${(e as Error).message})`;
        emit({ type: 'unavailable', dayId, reason: deviceOff });
        return;
      }
    }
    if (!(await getDay(dayId))) return; // день удалили, пока синтезировали
    await updateDay(dayId, { voice });
    emit({ type: 'ready', dayId });
  } catch (e) {
    emit({ type: 'error', dayId, error: (e as Error).message });
  } finally {
    running.delete(dayId);
  }
}

// ---------- запасная озвучка: голос браузера (Web Speech), когда у сервера нет ключа ----------

export const browserVoiceSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Список голосов браузер отдаёт не сразу — ждём voiceschanged, но не дольше 1,5 с. */
export function ensureBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!browserVoiceSupported()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/**
 * Правила те же, что у озвучки на сервере: голос выбирается по атмосфере, а не случайно.
 * Тихий день — мягкий голос (Светлана, Ирина), яркий — собранный (Дмитрий, Павел); нейросетевые голоса
 * («Natural», «Online») — первыми. Темп — recipe.voice.speed, высота — от тона: тяжелее — ниже.
 */
export function pickBrowserVoice(voices: SpeechSynthesisVoice[], energy: number): SpeechSynthesisVoice | undefined {
  const ru = voices.filter((v) => v.lang.toLowerCase().startsWith('ru'));
  if (!ru.length) return undefined;
  const natural = ru.filter((v) => /natural|online|neural/i.test(v.name));
  const pool = natural.length ? natural : ru;
  const want = energy >= 0.55 ? /dmitr|pavel|дмитр|павел/i : /svetlan|irina|dariya|светлан|ирин|дари/i;
  return pool.find((v) => want.test(v.name)) ?? pool[0];
}

export type BrowserSpeech = { voiceName: string; done: Promise<void>; stop: () => void };

export function speakInBrowser(text: string, recipe: Pick<Recipe, 'atmosphere' | 'voice'>): BrowserSpeech | null {
  if (!browserVoiceSupported()) return null;
  const voice = pickBrowserVoice(speechSynthesis.getVoices(), recipe.atmosphere.energy);
  if (!voice) return null;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = Math.min(1.3, Math.max(0.75, recipe.voice.speed));
  u.pitch = 0.85 + 0.3 * recipe.atmosphere.tone;
  const done = new Promise<void>((resolve) => {
    u.onend = () => resolve();
    u.onerror = () => resolve();
  });
  speechSynthesis.speak(u);
  return { voiceName: voice.name, done, stop: () => speechSynthesis.cancel() };
}
