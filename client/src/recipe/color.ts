export type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]: RGB): string =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

export const mixHex = (a: string, b: string, t: number): string => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
};

/** «Теплота» цвета: >0 тёплый (красно-жёлтый), <0 холодный (сине-голубой). */
export const warmthOf = (hex: string): number => {
  const [r, , b] = hexToRgb(hex);
  return (r - b) / 255;
};

/** Нормализованный RGB 0..1 для униформ шейдера. */
export const hexToVec = (hex: string): RGB => {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
};
