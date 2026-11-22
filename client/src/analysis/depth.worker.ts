/**
 * Карта глубины в Web Worker (SPEC §4.3): Depth Anything V2 Small через transformers.js.
 * WebGPU, если есть; иначе WASM. Только Small — у Base и Large некоммерческая лицензия.
 * Фото не покидает браузер: с Hugging Face Hub скачиваются только веса модели (и кэшируются).
 */
import { RawImage, env, pipeline, type ProgressInfo } from '@huggingface/transformers';
import { normalizeDepth } from './depthNormalize';

const MODEL = 'onnx-community/depth-anything-v2-small';
env.allowLocalModels = false;

type Request = { id: number; blob: Blob };
type Estimator = { run: (image: RawImage) => Promise<RawImage>; device: 'webgpu' | 'wasm'; dtype: string };

type GpuNavigator = { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } };

const progress = (p: ProgressInfo) => {
  if (p.status === 'progress_total') {
    self.postMessage({ type: 'progress', progress: p.progress, loaded: p.loaded, total: p.total });
  }
};

async function create(device: 'webgpu' | 'wasm', dtype: 'fp32' | 'fp16' | 'q8'): Promise<Estimator> {
  const estimator = await pipeline('depth-estimation', MODEL, { device, dtype, progress_callback: progress });
  return {
    device,
    dtype,
    run: async (image) => {
      const out = await estimator(image);
      return (Array.isArray(out) ? out[0] : out).depth;
    },
  };
}

async function load(): Promise<Estimator> {
  const gpu = (self.navigator as unknown as GpuNavigator).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) return await create('webgpu', adapter.features.has('shader-f16') ? 'fp16' : 'fp32');
    } catch (e) {
      console.warn('[depth] WebGPU не завёлся, перехожу на WASM:', e);
    }
  }
  return create('wasm', 'q8');
}

let estimator: Promise<Estimator> | null = null;

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, blob } = e.data;
  try {
    estimator ??= load();
    const est = await estimator;
    const t0 = performance.now();
    const depth = await est.run(await RawImage.fromBlob(blob));
    const normalized = new RawImage(normalizeDepth(depth.data, depth.channels), depth.width, depth.height, 1);
    const png: Blob = await normalized.toBlob('image/png');
    self.postMessage({ type: 'done', id, depth: png, device: est.device, dtype: est.dtype, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    estimator = null; // следующая попытка начнёт загрузку заново
    self.postMessage({ type: 'error', id, error: (err as Error)?.message ?? String(err) });
  }
};
