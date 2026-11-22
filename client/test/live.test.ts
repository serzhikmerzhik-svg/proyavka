/**
 * Живой снимок, композиции и папка дня (SPEC §4.3, §5, §6, §7.7). Запуск: npm test -w client
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { windowLayout, type Rect } from '../src/render/composition';
import { normalizeDepth } from '../src/analysis/depthNormalize';
import { buildDayZip, dayFolderName } from '../src/storage/zip';
import { buildRecipe } from '../src/recipe/buildRecipe';
import type { Day, MusicFeatures, TextAnalysis } from '../src/recipe/types';

const W = 800;
const H = 1000;
const inside = (r: Rect) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= W + 0.01 && r.y + r.h <= H + 0.01;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

test('single и sequence: одно окно на весь кадр', () => {
  for (const kind of ['single', 'sequence'] as const) {
    const L = windowLayout(kind, 3, 2, W, H);
    assert.equal(L.slots.length, 1);
    assert.deepEqual({ ...L.slots[0], label: '' }, { x: 0, y: 0, w: W, h: H, photo: 2, label: '' });
    assert.equal(L.circle, null);
  }
});

test('diptych: два кадра рядом, «кадр дня» первым, полоска бумаги между ними', () => {
  const L = windowLayout('diptych', 2, 1, W, H);
  assert.equal(L.base, 'paper');
  assert.deepEqual(L.slots.map((s) => s.photo), [1, 0]);
  assert.ok(L.slots.every(inside));
  assert.ok(!overlap(L.slots[0], L.slots[1]));
  assert.ok(L.slots[1].x > L.slots[0].x + L.slots[0].w, 'между кадрами есть зазор');
});

test('strip: кадры по порядку съёмки на плёнке с перфорацией', () => {
  const L = windowLayout('strip', 4, 2, W, H);
  assert.equal(L.base, 'film');
  assert.deepEqual(L.slots.map((s) => s.photo), [0, 1, 2, 3]);
  assert.ok(L.slots.every(inside));
  for (let i = 1; i < L.slots.length; i++) assert.ok(!overlap(L.slots[i - 1], L.slots[i]));
  assert.ok(L.sprockets.length > 4 && L.sprockets.every(inside));
  assert.equal(L.circle, null);
});

test('contact_sheet: сетка 2 × 3 и красный кружок на «кадре дня»', () => {
  const L = windowLayout('contact_sheet', 6, 4, W, H);
  assert.equal(L.slots.length, 6);
  assert.ok(L.slots.every(inside));
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.ok(!overlap(L.slots[i], L.slots[j]));
  assert.equal(L.slots[L.circle!].photo, 4);
  assert.deepEqual(L.slots.map((s) => s.label), ['1A', '2A', '3A', '4A', '5A', '6A']);
});

test('карта глубины растягивается на полный диапазон 0..255', () => {
  assert.deepEqual([...normalizeDepth([50, 100, 150])], [0, 128, 255]);
  // RGBA → берём первый канал
  assert.deepEqual([...normalizeDepth([10, 0, 0, 255, 20, 0, 0, 255], 4)], [0, 255]);
  assert.deepEqual([...normalizeDepth([7, 7])], [128, 128]);
});

test('шейдер получает глубину, параллакс, туман и частицы', () => {
  const shader = readFileSync(new URL('../src/render/shaders/print.frag.glsl', import.meta.url), 'utf8');
  for (const u of ['sampler2D uDepth', 'float uHasDepth', 'vec2 uParallax', 'float uAirTime', 'float uFrameSeed', 'float uFog', 'float uAirSnow']) {
    assert.ok(shader.includes(`uniform ${u};`), u);
  }
  assert.match(shader, /\(depth - 0\.5\) \* uParallax/, 'параллакс uv + (depth − 0.5) · uParallax');
});

test('демо-дни: 5 штук, все композиции, recipe.json совпадает с правилами buildRecipe', () => {
  const demo = (p: string) => JSON.parse(readFileSync(new URL(`../public/demo/${p}`, import.meta.url), 'utf8'));
  const index = demo('index.json') as { slug: string }[];
  assert.equal(index.length, 5);
  const compositions = new Set<string>();
  for (const { slug } of index) {
    const day = demo(`${slug}/day.json`);
    const analysis = demo(`${slug}/analysis.json`);
    const recipe = demo(`${slug}/recipe.json`);
    const rebuilt = buildRecipe({ text: day.text, date: day.date, analysis, music: analysis.music, photos: day.photos });
    assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)), recipe, `${slug}: recipe.json устарел — npm run demo:build`);
    assert.ok(day.text.toLowerCase().includes(recipe.caption.toLowerCase()), `${slug}: подпись не из текста`);
    compositions.add(recipe.composition);
  }
  assert.deepEqual([...compositions].sort(), ['contact_sheet', 'diptych', 'sequence', 'single', 'strip']);
});

test('ZIP папки дня: структура по разделу 7, без аудио песни', async () => {
  const music: MusicFeatures = { bpm: 72, beatOffset: 0.1, barSeconds: 3.333, rmsEnvelope: [0.2, 0.5], rmsMean: 0.4, brightness: 0.4, key: 'A', mode: 'minor', modeConfidence: 0.6 };
  const analysis: TextAnalysis = {
    atmosphere: { energy: 0.3, tone: 0.7, together: 0.8, special: 0.3 }, label: 'autochrome', timeOfDay: 'evening', season: 'autumn',
    contrast: { has: false }, air: ['steam'], captionQuote: 'пили какао', folderNames: ['Осенний парк и какао'], voiceStyle: 'тепло',
    bestPhotoIndex: 0, photoNotes: [],
  };
  const text = 'Вечером пили какао в парке.';
  const photos = [
    { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), width: 10, height: 10, palette: ['#808080'], depth: new Blob([new Uint8Array([9])], { type: 'image/png' }) },
    { blob: new Blob([new Uint8Array([4, 5])], { type: 'image/jpeg' }), width: 10, height: 10, palette: ['#404040'] },
  ];
  const recipe = buildRecipe({ text, date: '2026-11-19', analysis, music, photos });
  const day: Day = {
    id: 'x', date: '2026-11-19', folderName: recipe.folderName, text, photos,
    song: { source: 'deezer', id: '1', title: 'Песня', artist: 'Артист' },
    analysis: { ...analysis, music }, recipe, createdAt: 0,
    audioFile: new Blob([new Uint8Array([7, 7, 7])]),
  };
  const zip = await buildDayZip(day, { printPng: new Blob([new Uint8Array([8])], { type: 'image/png' }) });
  const back = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const dir = `${dayFolderName(day)}/`;
  assert.equal(dir, '2026-11-19 Осенний парк и какао/');
  const files = Object.keys(back.files).filter((f) => !back.files[f].dir).sort();
  assert.deepEqual(files, [
    `${dir}depth/01.png`, `${dir}photos/01.jpg`, `${dir}photos/02.jpg`,
    `${dir}print.png`, `${dir}recipe.json`, `${dir}song.json`, `${dir}text.md`,
  ].sort());
  const song = JSON.parse(await back.file(`${dir}song.json`)!.async('string'));
  assert.equal(song.title, 'Песня');
  assert.equal(song.music.bpm, 72);
  assert.ok(!files.some((f) => /\.(mp3|m4a|wav|ogg)$/.test(f) && !f.endsWith('voice.mp3')), 'аудио песни в папку не попадает');
  assert.deepEqual(JSON.parse(await back.file(`${dir}recipe.json`)!.async('string')), JSON.parse(JSON.stringify(recipe)));
  assert.match(await back.file(`${dir}text.md`)!.async('string'), /^# Осенний парк и какао/);
});
