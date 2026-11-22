/** Тональность и лад: корреляция средней хромы с профилями Крумхансла — Кесслера (24 тональности). */

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_RU = ['до', 'до-диез', 'ре', 'ре-диез', 'ми', 'фа', 'фа-диез', 'соль', 'соль-диез', 'ля', 'ля-диез', 'си'];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export type KeyResult = { key: string; mode: 'major' | 'minor'; confidence: number; tonic: number; r: number };

/** chroma[0] = C. confidence — насколько лучший лад обгоняет лучший вариант другого лада (0..1). */
export function detectKey(chroma: number[]): KeyResult {
  let best = { r: -Infinity, tonic: 0, mode: 'major' as 'major' | 'minor' };
  const bestByMode = { major: -Infinity, minor: -Infinity };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12]);
    for (const mode of ['major', 'minor'] as const) {
      const r = pearson(rotated, mode === 'major' ? MAJOR : MINOR);
      bestByMode[mode] = Math.max(bestByMode[mode], r);
      if (r > best.r) best = { r, tonic, mode };
    }
  }
  const other = best.mode === 'major' ? bestByMode.minor : bestByMode.major;
  const confidence = Math.min(1, Math.max(0, (best.r - other) * 5));
  return { key: PITCH_NAMES[best.tonic], mode: best.mode, confidence, tonic: best.tonic, r: best.r };
}

export const keyRu = (key: string, mode: 'major' | 'minor') => {
  const i = PITCH_NAMES.indexOf(key);
  return i < 0 ? '—' : `${PITCH_RU[i]} ${mode === 'major' ? 'мажор' : 'минор'}`;
};
