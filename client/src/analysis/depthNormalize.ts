/**
 * Нормализация карты глубины в полный диапазон 0..255 (SPEC §4.3: «нормализуй в 0..1»).
 * Пайплайн отдаёт глубину, делённую на максимум, — минимум не обязательно 0, поэтому растягиваем сами.
 * Чем светлее — тем ближе (Depth Anything предсказывает относительную обратную глубину).
 */
export function normalizeDepth(data: ArrayLike<number>, channels = 1): Uint8ClampedArray {
  const n = Math.floor(data.length / channels);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = data[i * channels];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Uint8ClampedArray(n);
  const range = max - min;
  for (let i = 0; i < n; i++) out[i] = range > 0 ? Math.round(((data[i * channels] - min) / range) * 255) : 128;
  return out;
}
