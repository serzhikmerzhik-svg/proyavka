/** Рецепт → числа для униформ шейдера (SPEC §5–6). */
import { blendPresets, type ProcessParams, type RGB } from '../recipe/presets';
import { hexToVec } from '../recipe/color';
import type { ProcessId, Recipe } from '../recipe/types';

/** То, что добавляет рецепт поверх процесса: свет, противоречие и воздух. */
export type LightParams = {
  warmth: number;
  splitShadows: RGB;
  splitHighlights: RGB;
  splitAmount: number;
  lowKey: number;
  liftShadows: number;
  /** туман по глубине (виден, когда есть карта глубины) */
  fog: number;
  /** плотности частиц воздуха; в кадре они ещё следуют за RMS */
  airSteam: number;
  airLeaves: number;
  airSnow: number;
  airRain: number;
  airDust: number;
};

export type ShaderParams = ProcessParams & LightParams;

export const NEUTRAL_LIGHT: LightParams = {
  warmth: 0,
  splitShadows: [0.5, 0.5, 0.5],
  splitHighlights: [0.5, 0.5, 0.5],
  splitAmount: 0,
  lowKey: 0,
  liftShadows: 0,
  fog: 0,
  airSteam: 0,
  airLeaves: 0,
  airSnow: 0,
  airRain: 0,
  airDust: 0,
};

/** Чистые процессы без поправок рецепта — для /lab. */
export function processParams(process: { id: ProcessId; weight: number }[]): ShaderParams {
  return { ...blendPresets(process), ...NEUTRAL_LIGHT };
}

export function resolveParams(recipe: Recipe): ShaderParams {
  const p = blendPresets(recipe.process);
  const { energy, tone, special } = recipe.atmosphere;

  // Настроение сдвигает насыщенность (и чуть-чуть контраст); цвета остаются из фото
  p.saturation *= 0.85 + 0.3 * tone;
  p.contrast *= 0.94 + 0.12 * energy;

  // Особенность дня усиливает зерно, ореолы и выцветание
  p.grainAmount *= 1 + 0.6 * special;
  p.halation *= 1 + 0.8 * special;
  p.fade += 0.15 * special;

  // Свет: ночь — низкий ключ и ореолы; закат и вечер — тёплый низкий свет; утро — приподнятые тени
  const time = recipe.light.time;
  if (time === 'night') p.halation += 0.25;
  if (time === 'golden_hour' || time === 'evening') {
    p.vignette += 0.08;
    p.halation += 0.08;
  }

  const split = recipe.splitTone;
  const air = recipe.air;
  const density = (kind: Recipe['air']['particles'][number]) => (air.particles.includes(kind) ? air.density : 0);
  return {
    ...p,
    warmth: recipe.light.warmth,
    splitShadows: split ? hexToVec(split.shadows) : NEUTRAL_LIGHT.splitShadows,
    splitHighlights: split ? hexToVec(split.highlights) : NEUTRAL_LIGHT.splitHighlights,
    splitAmount: split?.amount ?? 0,
    lowKey: time === 'night' ? 1 : 0,
    liftShadows: time === 'morning' ? 1 : 0,
    // лёгкая дымка вдали у всех дней; сильнее, если в словах дня туман
    fog: 0.18 + (air.particles.includes('fog') ? 0.45 : 0) + 0.1 * special,
    airSteam: density('steam'),
    airLeaves: density('leaves'),
    airSnow: density('snow'),
    airRain: density('rain'),
    airDust: density('dust'),
  };
}

/** Имя униформы для параметра: grainSize → uGrainSize. */
export const uniformName = (key: string) => `u${key[0].toUpperCase()}${key.slice(1)}`;
