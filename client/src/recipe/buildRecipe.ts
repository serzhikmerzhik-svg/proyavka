/**
 * Детерминированная сборка рецепта по правилам SPEC §5.
 * Один и тот же ввод → один и тот же отпечаток. Никакой случайности.
 */
import { ANCHORS } from './presets';
import { mixHex, warmthOf } from './color';
import { checkCaption, checkFolderNames } from './validate';
import { buildWhy } from './why';
import type { MusicFeatures, PhotoAsset, ProcessId, Recipe, TextAnalysis } from './types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export type RecipeInput = {
  text: string;
  date: string;
  analysis: TextAnalysis;
  music: MusicFeatures;
  photos: Pick<PhotoAsset, 'palette'>[];
  /** ручная поправка ползунками «тише ↔ ярче», «тяжелее ↔ светлее» (0..1) */
  overrides?: { energy?: number; tone?: number };
};

/** Энергия музыки: темп 60 → 0, 160 → 1, с поправкой на средний RMS. */
export const musicEnergy = (m: Pick<MusicFeatures, 'bpm' | 'rmsMean'>) =>
  clamp01(0.8 * clamp01((m.bpm - 60) / 100) + 0.2 * m.rmsMean);

/** Оси до ручной поправки: энергия = 0,6·текст + 0,4·музыка; тон = 0,7·текст + 0,3·лад. */
export function combineAxes(a: TextAnalysis, m: MusicFeatures) {
  return {
    energy: clamp01(0.6 * a.atmosphere.energy + 0.4 * musicEnergy(m)),
    tone: clamp01(0.7 * a.atmosphere.tone + 0.3 * (m.mode === 'major' ? 0.7 : 0.3)),
  };
}

/** Небольшой бонус процессу-подсказке модели: его расстояние умножается на 0,8. */
export const LABEL_BONUS = 0.8;

export type ProcessDistance = { id: ProcessId; distance: number };

export function rankProcesses(energy: number, tone: number, label?: ProcessId): ProcessDistance[] {
  return (Object.entries(ANCHORS) as [ProcessId, [number, number]][])
    .map(([id, [e, t]]) => ({ id, distance: Math.hypot(e - energy, t - tone) * (id === label ? LABEL_BONUS : 1) }))
    .sort((x, y) => x.distance - y.distance);
}

/** Два ближайших якоря, веса по обратному расстоянию, сумма = 1. */
export function chooseProcesses(energy: number, tone: number, label?: ProcessId): Recipe['process'] {
  const [a, b] = rankProcesses(energy, tone, label);
  const wa = 1 / (a.distance + 1e-3);
  const wb = 1 / (b.distance + 1e-3);
  const first = round2(wa / (wa + wb));
  return [
    { id: a.id, weight: first },
    { id: b.id, weight: round2(1 - first) },
  ];
}

/** Палитра — только из фото: сначала «кадр дня», затем остальные, без повторов. */
function mergePalettes(photos: Pick<PhotoAsset, 'palette'>[], best: number): string[] {
  const order = [best, ...photos.map((_, i) => i).filter((i) => i !== best)];
  const out: string[] = [];
  for (const i of order) for (const c of photos[i]?.palette ?? []) if (!out.includes(c)) out.push(c);
  return out.slice(0, 6);
}

/** Тёплый низкий свет вечером и в золотой час, прохладнее ночью. */
const LIGHT_WARMTH: Record<Recipe['light']['time'], number> = {
  golden_hour: 0.6, evening: 0.4, morning: 0.1, day: 0, night: -0.2, unknown: 0,
};

export function buildRecipe(input: RecipeInput): Recipe {
  const { analysis: a, music } = input;

  // Оси: текст + музыка, ползунки пользователя главнее
  const combined = combineAxes(a, music);
  const energy = round2(clamp01(input.overrides?.energy ?? combined.energy));
  const tone = round2(clamp01(input.overrides?.tone ?? combined.tone));
  const atmosphere = { ...a.atmosphere, energy, tone };

  // Процесс
  const process = chooseProcesses(energy, tone, a.label);

  // Цвет — из фото; настроение только сдвигает температуру (light.warmth) и насыщенность (в рендере)
  const bestPhotoIndex = Math.min(Math.max(0, a.bestPhotoIndex), Math.max(0, input.photos.length - 1));
  const palette = mergePalettes(input.photos, bestPhotoIndex);

  // Противоречие → сплит-тонирование: тени из самого холодного цвета (к синему), света из самого тёплого (к янтарю)
  let splitTone: Recipe['splitTone'];
  if (a.contrast.has && palette.length >= 2) {
    const byWarmth = [...palette].sort((x, y) => warmthOf(x) - warmthOf(y));
    splitTone = {
      shadows: mixHex(byWarmth[0], '#1f4f9c', 0.4),
      highlights: mixHex(byWarmth[byWarmth.length - 1], '#ffb347', 0.4),
      amount: round2(0.35 + 0.15 * a.atmosphere.special),
    };
  }

  // Свет
  const warmth = round2(Math.max(-1, Math.min(1, LIGHT_WARMTH[a.timeOfDay] + (tone - 0.5) * 0.4)));

  // Ритм: такт = 4·60/bpm
  const bpm = music.bpm;
  const frameHoldBars = bpm < 90 ? 1 : bpm <= 120 ? 0.5 : 0.25;
  const developBars = energy < 0.4 ? 4 : energy < 0.7 ? 3 : 2;
  const transition = energy > 0.7 ? 'cut' : 'dissolve';

  // Композиция
  const n = input.photos.length;
  const composition: Recipe['composition'] =
    n <= 1 ? 'single'
      : n === 2 ? (a.atmosphere.together > 0.6 ? 'diptych' : 'sequence')
        : n <= 4 ? (energy > 0.7 ? 'strip' : 'sequence')
          : 'contact_sheet';

  const particles = [...new Set(a.air)];
  const partial = {
    folderName: checkFolderNames(a.folderNames, input.date).name,
    atmosphere,
    process,
    palette,
    splitTone,
    light: { time: a.timeOfDay, warmth },
    music: { ...music, barSeconds: Math.round(240_000 / bpm) / 1000 },
    rhythm: { developBars, frameHoldBars, transition },
    composition,
    bestPhotoIndex,
    air: { particles, density: particles.length ? round2(0.3 + 0.4 * energy) : 0 },
    caption: checkCaption(a.captionQuote, input.text).caption,
    voice: { style: a.voiceStyle, speed: round2(0.9 + 0.25 * energy) },
  } satisfies Omit<Recipe, 'why'>;

  return { ...partial, why: buildWhy(partial, a, input.text, n) };
}
