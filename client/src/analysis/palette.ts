import { rgbToHex, type RGB } from '../recipe/color';

/**
 * Палитра по пикселям RGBA: median cut, цвета по убыванию площади.
 * Чистая функция — ею же пользуется скрипт демо-дней в Node.
 */
export function paletteFromPixels(data: ArrayLike<number>, count = 5): string[] {
  const pixels: RGB[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pixels.length === 0) return ['#808080'];

  type Box = { px: RGB[]; channel: 0 | 1 | 2; range: number };
  const describe = (px: RGB[]): Box => {
    const min: RGB = [255, 255, 255];
    const max: RGB = [0, 0, 0];
    for (const p of px) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], p[c]); max[c] = Math.max(max[c], p[c]); }
    const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const channel = ranges.indexOf(Math.max(...ranges)) as 0 | 1 | 2;
    return { px, channel, range: ranges[channel] };
  };

  const boxes: Box[] = [describe(pixels)];
  while (boxes.length < count) {
    // делим коробку с наибольшим «объёмом» (диапазон × число пикселей)
    let idx = -1;
    let bestScore = 0;
    boxes.forEach((b, i) => {
      const s = b.range * b.px.length;
      if (b.px.length > 1 && s > bestScore) { bestScore = s; idx = i; }
    });
    if (idx < 0) break;
    const box = boxes.splice(idx, 1)[0];
    const sorted = [...box.px].sort((a, b) => a[box.channel] - b[box.channel]);
    const mid = sorted.length >> 1;
    boxes.push(describe(sorted.slice(0, mid)), describe(sorted.slice(mid)));
  }

  return boxes
    .sort((a, b) => b.px.length - a.px.length)
    .map((b) => {
      const sum = b.px.reduce<RGB>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      return rgbToHex([sum[0] / b.px.length, sum[1] / b.px.length, sum[2] / b.px.length]);
    });
}

/** Палитра фото в браузере: уменьшенная копия 64 px → median cut. */
export function extractPalette(source: CanvasImageSource, srcW: number, srcH: number, count = 5): string[] {
  const size = 64;
  const scale = size / Math.max(srcW, srcH);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return paletteFromPixels(ctx.getImageData(0, 0, w, h).data, count);
}
