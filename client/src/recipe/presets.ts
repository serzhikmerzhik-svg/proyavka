import type { ProcessId } from './types';

/** Якоря процессов на плоскости (энергия, тон) — SPEC §5. */
export const ANCHORS: Record<ProcessId, [energy: number, tone: number]> = {
  cyanotype: [0.12, 0.82],
  autochrome: [0.33, 0.69],
  kodachrome: [0.69, 0.88],
  instant: [0.73, 0.63],
  trichrome: [0.93, 0.76],
  double_exposure: [0.22, 0.45],
  solarization: [0.56, 0.38],
  push_montage: [0.93, 0.21],
  platinum: [0.17, 0.22],
};

export const PROCESS_IDS = Object.keys(ANCHORS) as ProcessId[];

export const PROCESS_NAMES: Record<ProcessId, string> = {
  cyanotype: 'цианотипия',
  autochrome: 'автохром',
  kodachrome: 'Kodachrome',
  instant: 'моментальное фото',
  trichrome: 'трихром',
  push_montage: 'пуш-монтаж',
  double_exposure: 'двойная экспозиция',
  platinum: 'платинотипия',
  solarization: 'соляризация',
};

export type RGB = [number, number, number];

/**
 * Вектор параметров одного шейдера (SPEC §6). Пресеты процессов — это значения этого вектора;
 * рецепт смешивает два пресета по весам на CPU, шейдер получает уже готовые числа.
 */
export type ProcessParams = {
  /** линейный контраст вокруг середины */
  contrast: number;
  /** жёсткость S-кривой, 0..1 */
  sCurve: number;
  saturation: number;
  /** добавочная насыщенность красных и жёлтых (Kodachrome) */
  warmBoost: number;
  /** плотность теней, 0..1 */
  shadowDensity: number;
  /** приподнятые чёрные */
  lift: number;
  /** выцветание к бумаге */
  fade: number;
  /** размер зерна, px */
  grainSize: number;
  grainAmount: number;
  /** доля цветного зерна (у монохромных процессов 0) */
  grainChroma: number;
  halation: number;
  vignette: number;
  /** вспышка: светлый центр, быстрый спад к краям (моментальное фото) */
  flash: number;
  /** тонирование процесса: цвет теней, цвет светов, сила */
  toneShadows: RGB;
  toneHighlights: RGB;
  toneAmount: number;
  // доли эффектов
  monochrome: number;
  cyanotype: number;
  autochrome: number;
  trichrome: number;
  solarize: number;
  doubleExposure: number;
  /** диагональная сетка кадрирования (пуш-монтаж) */
  grid: number;
};

const NEUTRAL: RGB = [0.5, 0.5, 0.5];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const base: ProcessParams = {
  contrast: 1, sCurve: 0, saturation: 1, warmBoost: 0, shadowDensity: 0, lift: 0.03, fade: 0.08,
  grainSize: 1.5, grainAmount: 0.18, grainChroma: 0.35, halation: 0.18, vignette: 0.4, flash: 0,
  toneShadows: NEUTRAL, toneHighlights: NEUTRAL, toneAmount: 0,
  monochrome: 0, cyanotype: 0, autochrome: 0, trichrome: 0, solarize: 0, doubleExposure: 0, grid: 0,
};
const p = (o: Partial<ProcessParams>): ProcessParams => ({ ...base, ...o });

export const PRESETS: Record<ProcessId, ProcessParams> = {
  // мозаика окрашенных зёрен крахмала, мягкость, пастель
  autochrome: p({ contrast: 0.92, saturation: 0.9, grainSize: 2.5, grainAmount: 0.2, halation: 0.25, fade: 0.18, vignette: 0.5, lift: 0.06, autochrome: 1 }),
  // берлинская лазурь → бумага
  cyanotype: p({ contrast: 1.1, sCurve: 0.2, saturation: 0, grainAmount: 0.14, grainChroma: 0, halation: 0.08, fade: 0.12, vignette: 0.35, lift: 0.02, monochrome: 1, cyanotype: 1 }),
  // насыщенные красные и жёлтые, плотные тени
  kodachrome: p({ contrast: 1.18, sCurve: 0.3, saturation: 1.3, warmBoost: 0.55, shadowDensity: 0.45, grainSize: 1.2, grainAmount: 0.1, grainChroma: 0.25, halation: 0.12, fade: 0.03, vignette: 0.3, lift: 0,
    toneShadows: hex('#3b2a26'), toneHighlights: hex('#fff1d6'), toneAmount: 0.12 }),
  // приподнятые чёрные, циановые тени, тёплые света, вспышка
  instant: p({ contrast: 0.88, sCurve: 0.15, saturation: 1.05, grainAmount: 0.16, halation: 0.3, fade: 0.22, vignette: 0.55, lift: 0.13, flash: 0.75,
    toneShadows: hex('#2f8c9a'), toneHighlights: hex('#ffd49a'), toneAmount: 0.45 }),
  // три цветоделённых экспозиции со сдвигом каналов по долям
  trichrome: p({ contrast: 1.1, sCurve: 0.2, saturation: 1.25, grainAmount: 0.18, halation: 0.2, vignette: 0.35, trichrome: 1 }),
  // монохром, жёсткая S-кривая, крупное зерно, сетка кадрирования
  push_montage: p({ contrast: 1.35, sCurve: 1, saturation: 0, shadowDensity: 0.3, grainSize: 3.2, grainAmount: 0.5, grainChroma: 0, halation: 0.1, fade: 0.04, vignette: 0.6, lift: 0, monochrome: 1, grid: 1 }),
  // экранное смешивание двух кадров
  double_exposure: p({ contrast: 0.95, saturation: 0.8, grainSize: 1.8, grainAmount: 0.2, halation: 0.3, fade: 0.2, vignette: 0.45, doubleExposure: 1 }),
  // тёплый нейтральный тон, низкий контраст
  platinum: p({ contrast: 0.78, saturation: 0, grainSize: 1.4, grainAmount: 0.14, grainChroma: 0, halation: 0.14, fade: 0.22, vignette: 0.42, lift: 0.05, monochrome: 1,
    toneShadows: hex('#5a4636'), toneHighlights: hex('#efe3cc'), toneAmount: 0.7 }),
  // кривая Сабатье и линии Маки
  solarization: p({ contrast: 1.05, saturation: 0.75, grainSize: 1.8, grainAmount: 0.22, halation: 0.2, fade: 0.08, vignette: 0.45, solarize: 1 }),
};

type ScalarKey = { [K in keyof ProcessParams]: ProcessParams[K] extends number ? K : never }[keyof ProcessParams];
const SCALAR_KEYS = (Object.keys(base) as (keyof ProcessParams)[]).filter(
  (k): k is ScalarKey => typeof base[k] === 'number',
);

/**
 * Смешивание пресетов по весам (сумма весов = 1).
 * Числа — линейно. Цвета тонирования — с весом «вес × сила тонирования», чтобы процесс без
 * тонирования не разбавлял цвет серым, а только ослаблял силу.
 */
export function blendPresets(process: { id: ProcessId; weight: number }[]): ProcessParams {
  const out = { ...base, toneShadows: [0, 0, 0] as RGB, toneHighlights: [0, 0, 0] as RGB, toneAmount: 0 };
  for (const k of SCALAR_KEYS) out[k] = 0;
  let toneWeight = 0;
  for (const { id, weight } of process) {
    const preset = PRESETS[id];
    for (const k of SCALAR_KEYS) out[k] += preset[k] * weight;
    const w = weight * preset.toneAmount;
    toneWeight += w;
    for (let c = 0; c < 3; c++) {
      out.toneShadows[c] += preset.toneShadows[c] * w;
      out.toneHighlights[c] += preset.toneHighlights[c] * w;
    }
  }
  if (toneWeight > 0) {
    for (let c = 0; c < 3; c++) {
      out.toneShadows[c] /= toneWeight;
      out.toneHighlights[c] /= toneWeight;
    }
  } else {
    out.toneShadows = [...NEUTRAL];
    out.toneHighlights = [...NEUTRAL];
  }
  return out;
}
