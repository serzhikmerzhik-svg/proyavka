/**
 * Глубина кадров: очередь к воркеру и фоновое дополнение дня картами глубины.
 * День сохраняется сразу, а глубина досчитывается в фоне — снимок «оживает», когда она готова.
 */
import { getDay, updateDay } from '../storage/db';

export type DepthResult = { depth: Blob; device: 'webgpu' | 'wasm'; dtype: string; ms: number };
export type DepthEvent =
  | { type: 'progress'; progress: number; loaded: number; total: number }
  | { type: 'photo'; dayId: string; index: number; device: string; ms: number }
  | { type: 'error'; dayId: string; error: string };

type Pending = { resolve: (r: DepthResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
const listeners = new Set<(e: DepthEvent) => void>();
let queue: Promise<unknown> = Promise.resolve();
const running = new Set<string>();

export function onDepth(listener: (e: DepthEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const emit = (e: DepthEvent) => listeners.forEach((l) => l(e));

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'progress') emit(m);
    else if (m.type === 'done') {
      pending.get(m.id)?.resolve({ depth: m.depth, device: m.device, dtype: m.dtype, ms: m.ms });
      pending.delete(m.id);
    } else if (m.type === 'error') {
      pending.get(m.id)?.reject(new Error(m.error));
      pending.delete(m.id);
    }
  };
  worker.onerror = (e) => {
    pending.forEach((p) => p.reject(new Error(e.message || 'воркер глубины упал')));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** Один кадр → PNG карты глубины. Запросы идут по очереди: модель одна. */
export function estimateDepth(blob: Blob): Promise<DepthResult> {
  const run = () =>
    new Promise<DepthResult>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, blob });
    });
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** Досчитать глубину для всех кадров дня, у которых её нет. Повторный вызов для того же дня — no-op. */
export async function addDepthToDay(dayId: string): Promise<void> {
  if (running.has(dayId)) return;
  running.add(dayId);
  try {
    const day = await getDay(dayId);
    if (!day) return;
    for (let i = 0; i < day.photos.length; i++) {
      if (day.photos[i].depth) continue;
      const r = await estimateDepth(day.photos[i].blob);
      const fresh = await getDay(dayId);
      if (!fresh) return; // день удалили, пока считали
      const photos = fresh.photos.map((p, j) => (j === i ? { ...p, depth: r.depth } : p));
      await updateDay(dayId, { photos });
      emit({ type: 'photo', dayId, index: i, device: r.device, ms: r.ms });
    }
  } catch (e) {
    emit({ type: 'error', dayId, error: (e as Error).message });
  } finally {
    running.delete(dayId);
  }
}
