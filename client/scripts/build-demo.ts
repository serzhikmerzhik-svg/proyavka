/**
 * Сборка демо-дней (client/public/demo/<slug>/):
 *   day.json      — дата, текст, песня (правите вы); список фото с палитрами заполняет скрипт
 *   analysis.json — смысл дня, как его вернула бы модель, + признаки песни (music)
 *   photos/*.jpg  — ваши фото; если папка пуста — рисуются процедурные заглушки
 *   recipe.json   — собирается здесь по правилам SPEC §5 (buildRecipe), руками не править
 *
 *   npm run demo:build                — пересобрать палитры и рецепты
 *   npm run demo:build -- --reanalyze — заново разобрать тексты эвристикой (после замены текстов)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { buildRecipe } from '../src/recipe/buildRecipe';
import { paletteFromPixels } from '../src/analysis/palette';
import { checkCaption } from '../src/recipe/validate';
import { analyzeHeuristic } from '../../server/src/heuristic';
import type { MusicFeatures, PhotoAsset, SongRef, TextAnalysis } from '../src/recipe/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(here, '../public/demo');
const SLUGS = ['osenniy-park', 'noch-v-ofise', 'pervyy-sneg', 'vypusknoy', 'dozhd-i-kniga'];
const reanalyze = process.argv.includes('--reanalyze');

type DayJson = {
  date: string;
  text: string;
  song: SongRef;
  placeholder?: { theme: Theme; count: number };
  photos: { file: string; width: number; height: number; palette: string[] }[];
};
type AnalysisJson = TextAnalysis & { music: MusicFeatures };

// ---------- процедурные заглушки (не нейросеть: градиенты и фигуры) ----------
type Theme = 'autumn' | 'office' | 'snow' | 'sunset' | 'rain';
type Img = { w: number; h: number; data: Uint8Array };
type C3 = [number, number, number];

const hex = (h: string): C3 => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function blank(w: number, h: number): Img {
  return { w, h, data: new Uint8Array(w * h * 4).fill(255) };
}
function put(im: Img, x: number, y: number, c: C3, a: number) {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h || a <= 0) return;
  const i = (y * im.w + x) * 4;
  for (let k = 0; k < 3; k++) im.data[i + k] = Math.round(im.data[i + k] * (1 - a) + c[k] * a);
}
function vgrad(im: Img, stops: [number, string][]) {
  const cs = stops.map(([t, c]) => [t, hex(c)] as const);
  for (let y = 0; y < im.h; y++) {
    const t = y / (im.h - 1);
    let j = 0;
    while (j < cs.length - 2 && t > cs[j + 1][0]) j++;
    const [t0, c0] = cs[j];
    const [t1, c1] = cs[j + 1];
    const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    const c: C3 = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    for (let x = 0; x < im.w; x++) put(im, x, y, c, 1);
  }
}
function rect(im: Img, x: number, y: number, w: number, h: number, c: string, a = 1) {
  const col = hex(c);
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(im.h, Math.round(y + h)); yy++)
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(im.w, Math.round(x + w)); xx++) put(im, xx, yy, col, a);
}
function disc(im: Img, cx: number, cy: number, r: number, c: string, a = 1) {
  const col = hex(c);
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      put(im, x, y, col, a * Math.min(1, Math.max(0, r - d + 0.5)));
    }
}
function glow(im: Img, cx: number, cy: number, r: number, c: string, a: number) {
  const col = hex(c);
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1) put(im, x, y, col, a * (1 - d) * (1 - d));
    }
}
function streak(im: Img, x: number, y: number, len: number, slope: number, c: string, a: number) {
  const col = hex(c);
  for (let t = 0; t < len; t++) put(im, Math.round(x + t * slope), Math.round(y + t), col, a);
}
function tri(im: Img, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: string) {
  const col = hex(c);
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const s = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const d1 = s(x, y, ax, ay, bx, by);
      const d2 = s(x, y, bx, by, cx, cy);
      const d3 = s(x, y, cx, cy, ax, ay);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) put(im, x, y, col, 1);
    }
}
function grain(im: Img, amount: number) {
  for (let i = 0; i < im.data.length; i += 4) {
    const g = (rnd() - 0.5) * amount;
    for (let k = 0; k < 3; k++) im.data[i + k] = Math.max(0, Math.min(255, im.data[i + k] + g));
  }
}

function placeholder(theme: Theme, i: number): Img {
  seed = 1000 + i * 77 + theme.length * 13;
  const landscape = i % 2 === 1;
  const im = blank(landscape ? 1125 : 900, landscape ? 900 : 1125);
  const { w, h } = im;
  if (theme === 'autumn') {
    vgrad(im, [[0, '#f4c27a'], [0.5, '#e48b4a'], [0.72, '#8a4a2a'], [1, '#3b2417']]);
    glow(im, w * 0.68, h * 0.28, w * 0.35, '#fff1c8', 0.6);
    disc(im, w * 0.68, h * 0.28, w * 0.07, '#fff6dc');
    for (let k = 0; k < 6; k++) rect(im, w * (0.08 + k * 0.17 + (i % 2) * 0.05), h * 0.25, w * 0.035, h * 0.55, '#24160e');
    for (let k = 0; k < 420; k++) disc(im, rnd() * w, h * (0.35 + rnd() * 0.65), 3 + rnd() * 6, ['#c2471f', '#e2862b', '#f0b43a', '#8f2f18'][k % 4], 0.85);
    if (i === 1) {
      rect(im, w * 0.25, h * 0.7, w * 0.5, h * 0.04, '#3a2618');
      disc(im, w * 0.42, h * 0.66, w * 0.035, '#f6efe4');
      disc(im, w * 0.55, h * 0.66, w * 0.035, '#f6efe4');
      glow(im, w * 0.48, h * 0.55, w * 0.1, '#ffffff', 0.25);
    }
  } else if (theme === 'office') {
    vgrad(im, [[0, '#0a1220'], [0.6, '#16243c'], [1, '#05080e']]);
    for (let y = 0.06; y < 0.4; y += 0.07)
      for (let x = 0.05; x < 0.95; x += 0.09) if (rnd() > 0.45) rect(im, w * x, h * y, w * 0.05, h * 0.035, ['#f3d48a', '#9cc8f0'][Math.floor(rnd() * 2)], 0.7);
    for (let k = 0; k < 3; k++) {
      const x = w * (0.1 + k * 0.3 + (i % 3) * 0.03);
      glow(im, x + w * 0.1, h * 0.58, w * 0.18, '#3fb7d9', 0.35);
      rect(im, x, h * 0.5, w * 0.2, h * 0.13, '#4fc3e6');
    }
    rect(im, 0, h * 0.72, w, h * 0.28, '#0b0f16');
    if (i === 1) for (let k = 0; k < 3; k++) {
      disc(im, w * (0.25 + k * 0.22), h * 0.62, w * 0.045, '#1c2636');
      rect(im, w * (0.21 + k * 0.22), h * 0.66, w * 0.08, h * 0.12, '#1c2636');
    }
    if (i === 2) disc(im, w * 0.6, h * 0.8, w * 0.06, '#d9d4cc');
  } else if (theme === 'snow') {
    vgrad(im, [[0, '#bcd3ea'], [0.55, '#e6eef7'], [1, '#ffffff']]);
    rect(im, w * 0.1, h * 0.38, w * 0.38, h * 0.28, '#7a5640');
    tri(im, w * 0.06, h * 0.39, w * 0.52, h * 0.39, w * 0.29, h * 0.2, '#5a3a2a');
    tri(im, w * 0.06, h * 0.39, w * 0.52, h * 0.39, w * 0.29, h * 0.24, '#f7fbff');
    rect(im, w * 0.2, h * 0.47, w * 0.08, h * 0.08, '#f3d48a');
    disc(im, w * 0.7, h * 0.78, w * 0.12, '#fbfdff');
    disc(im, w * 0.7, h * 0.6, w * 0.085, '#fbfdff');
    disc(im, w * 0.7, h * 0.47, w * 0.06, '#fbfdff');
    disc(im, w * 0.69, h * 0.46, w * 0.008, '#222222');
    disc(im, w * 0.72, h * 0.46, w * 0.008, '#222222');
    for (let k = 0; k < 700; k++) disc(im, rnd() * w, rnd() * h, 1.5 + rnd() * 3.5, '#ffffff', 0.9);
  } else if (theme === 'sunset') {
    vgrad(im, [[0, '#f7c37a'], [0.35, '#f08a5d'], [0.58, '#a8436b'], [0.6, '#7a3a5a'], [1, '#2a1e3a']]);
    glow(im, w * (0.35 + 0.08 * (i % 3)), h * 0.55, w * 0.4, '#ffd9a0', 0.5);
    disc(im, w * (0.35 + 0.08 * (i % 3)), h * 0.55, w * 0.09, '#ffe7b8');
    for (let k = 0; k < 40; k++) rect(im, w * (0.15 + rnd() * 0.6), h * (0.62 + rnd() * 0.3), w * (0.05 + rnd() * 0.2), 3, '#ffb070', 0.6);
    if (i === 1 || i === 2 || i === 4) {
      const n = i === 2 ? 7 : 3;
      for (let k = 0; k < n; k++) {
        const x = w * (0.12 + k * (0.76 / n)) + rnd() * 10;
        disc(im, x + w * 0.035, h * 0.45, w * 0.03, '#2a1626');
        rect(im, x, h * 0.48, w * 0.07, h * 0.22, '#2a1626');
      }
    }
  } else {
    vgrad(im, [[0, '#8d9aa6'], [0.5, '#5c6874'], [1, '#3a434c']]);
    if (i === 2) for (let k = 0; k < 12; k++) disc(im, rnd() * w, h * (0.5 + rnd() * 0.3), w * (0.05 + rnd() * 0.08), '#33463a', 0.6);
    for (let k = 0; k < 900; k++) streak(im, rnd() * w, rnd() * h, 8 + rnd() * 26, 0.12, '#dfe6ec', 0.35);
    for (let k = 0; k < 160; k++) disc(im, rnd() * w, rnd() * h, 2 + rnd() * 5, '#e8eef3', 0.55);
    rect(im, w * 0.48, 0, w * 0.04, h, '#2b2f33');
    rect(im, 0, h * 0.46, w, h * 0.035, '#2b2f33');
    if (i === 1) {
      rect(im, w * 0.2, h * 0.68, w * 0.36, h * 0.18, '#ece3cf');
      rect(im, w * 0.375, h * 0.68, w * 0.01, h * 0.18, '#b8ab90');
      disc(im, w * 0.7, h * 0.76, w * 0.07, '#f4efe6');
      disc(im, w * 0.7, h * 0.76, w * 0.05, '#8a5a35');
    }
  }
  grain(im, 10);
  return im;
}

// ---------- сборка ----------
function readPhoto(file: string) {
  const raw = jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true });
  // уменьшенная копия ~64 px — как в браузере
  const k = 64 / Math.max(raw.width, raw.height);
  const w = Math.max(1, Math.round(raw.width * k));
  const h = Math.max(1, Math.round(raw.height * k));
  const small = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (Math.floor(y / k) * raw.width + Math.floor(x / k)) * 4;
      small.set(raw.data.subarray(si, si + 4), (y * w + x) * 4);
    }
  return { width: raw.width, height: raw.height, palette: paletteFromPixels(small, 5) };
}

const index: { slug: string; date: string; folderName: string }[] = [];
for (const slug of SLUGS) {
  const dir = path.join(DEMO, slug);
  const dayPath = path.join(dir, 'day.json');
  const day = JSON.parse(readFileSync(dayPath, 'utf8')) as DayJson;
  const photosDir = path.join(dir, 'photos');
  mkdirSync(photosDir, { recursive: true });

  let files = readdirSync(photosDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  if (files.length === 0 && day.placeholder) {
    for (let i = 0; i < day.placeholder.count; i++) {
      const im = placeholder(day.placeholder.theme, i);
      const name = `${String(i + 1).padStart(2, '0')}.jpg`;
      writeFileSync(path.join(photosDir, name), jpeg.encode({ data: Buffer.from(im.data), width: im.w, height: im.h }, 82).data);
    }
    files = readdirSync(photosDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  }
  if (files.length === 0) throw new Error(`${slug}: нет фото в ${photosDir}`);
  day.photos = files.map((file) => ({ file, ...readPhoto(path.join(photosDir, file)) }));

  const analysisPath = path.join(dir, 'analysis.json');
  let analysis: AnalysisJson;
  const old = existsSync(analysisPath) ? (JSON.parse(readFileSync(analysisPath, 'utf8')) as AnalysisJson) : null;
  if (!old || reanalyze) {
    if (!old?.music) throw new Error(`${slug}: в analysis.json нужен блок music (признаки песни — снимите на /lab/music)`);
    const text = analyzeHeuristic({
      text: day.text, date: day.date, photoCount: files.length, takenAt: [], photos: [],
      song: { title: day.song.title, artist: day.song.artist, year: day.song.year, genre: day.song.genre },
    });
    analysis = { ...text, music: old.music };
    writeFileSync(analysisPath, JSON.stringify(analysis, null, 2) + '\n');
  } else {
    analysis = old;
  }

  const photos: Pick<PhotoAsset, 'palette'>[] = day.photos.map((p) => ({ palette: p.palette }));
  const recipe = buildRecipe({ text: day.text, date: day.date, analysis, music: analysis.music, photos });
  const caption = checkCaption(analysis.captionQuote, day.text);
  writeFileSync(dayPath, JSON.stringify(day, null, 2) + '\n');
  writeFileSync(path.join(dir, 'recipe.json'), JSON.stringify(recipe, null, 2) + '\n');
  index.push({ slug, date: day.date, folderName: recipe.folderName });
  console.log(
    `${slug}: «${recipe.folderName}» · ${files.length} кадр. → ${recipe.composition} · ` +
      `${recipe.process.map((p) => `${p.id} ${Math.round(p.weight * 100)}%`).join(' + ')} · ` +
      `${recipe.music.bpm} BPM${caption.replaced ? ` · подпись заменена: ${caption.reason}` : ''}`,
  );
}
writeFileSync(path.join(DEMO, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`index.json: ${index.length} дней`);
