/**
 * Правила рецепта (SPEC §5) и клиентские проверки (SPEC §4.4). Запуск: npm test -w client
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipe, chooseProcesses, combineAxes, musicEnergy, type RecipeInput } from '../src/recipe/buildRecipe';
import { checkCaption, checkFolderNames, folderNameIssue } from '../src/recipe/validate';
import type { MusicFeatures, TextAnalysis } from '../src/recipe/types';

const music = (bpm: number, mode: 'major' | 'minor' = 'major', rmsMean = 0.5): MusicFeatures => ({
  bpm, beatOffset: 0, barSeconds: 240 / bpm, rmsEnvelope: [], rmsMean, brightness: 0.5,
  key: 'C', mode, modeConfidence: 0.5,
});

const analysis = (over: Partial<TextAnalysis> = {}): TextAnalysis => ({
  atmosphere: { energy: 0.5, tone: 0.6, together: 0.5, special: 0.3 },
  label: 'autochrome',
  timeOfDay: 'evening',
  season: 'autumn',
  contrast: { has: false },
  air: [],
  captionQuote: 'пили какао в парке',
  folderNames: ['Осенний парк и какао'],
  voiceStyle: 'Говори тепло.',
  bestPhotoIndex: 0,
  photoNotes: [],
  ...over,
});

const TEXT = 'Было холодно, но мы пили какао в парке. Листья шуршали под ногами.';
const input = (over: Partial<RecipeInput> = {}): RecipeInput => ({
  text: TEXT,
  date: '2026-11-19',
  analysis: analysis(),
  music: music(110),
  photos: [{ palette: ['#203040', '#c08040', '#808080'] }],
  ...over,
});

// ---------- оси ----------
test('оси: энергия 0,6·текст + 0,4·музыка; тон 0,7·текст + 0,3·лад', () => {
  assert.equal(musicEnergy(music(60, 'major', 0)), 0);
  assert.equal(musicEnergy(music(160, 'major', 1)), 1);
  const axes = combineAxes(analysis(), music(110)); // музыка: 0,8·0,5 + 0,2·0,5 = 0,5
  assert.ok(Math.abs(axes.energy - 0.5) < 1e-9);
  assert.ok(Math.abs(axes.tone - (0.7 * 0.6 + 0.3 * 0.7)) < 1e-9);
  const minor = combineAxes(analysis(), music(110, 'minor'));
  assert.ok(Math.abs(minor.tone - (0.7 * 0.6 + 0.3 * 0.3)) < 1e-9);
});

test('ползунки заменяют оси', () => {
  const r = buildRecipe(input({ overrides: { energy: 0.9, tone: 0.2 } }));
  assert.equal(r.atmosphere.energy, 0.9);
  assert.equal(r.atmosphere.tone, 0.2);
  assert.equal(r.process[0].id, 'push_montage');
});

// ---------- процесс ----------
test('процесс: два ближайших якоря, веса по обратному расстоянию, сумма 1', () => {
  const p = chooseProcesses(0.33, 0.69);
  assert.equal(p[0].id, 'autochrome');
  assert.ok(p[0].weight > 0.95);
  assert.equal(p[0].weight + p[1].weight, 1);
  const mid = chooseProcesses(0.225, 0.755); // ровно между цианотипией и автохромом
  assert.deepEqual(mid.map((x) => x.id).sort(), ['autochrome', 'cyanotype']);
  assert.ok(Math.abs(mid[0].weight - 0.5) <= 0.01);
});

test('подсказка модели даёт своему процессу небольшой бонус', () => {
  // точка чуть ближе к цианотипии (0,111), чем к автохрому (0,136): бонус ×0,8 переворачивает порядок
  const plain = chooseProcesses(0.215, 0.762);
  const hinted = chooseProcesses(0.215, 0.762, 'autochrome');
  assert.equal(plain[0].id, 'cyanotype');
  assert.equal(hinted[0].id, 'autochrome');
  // далёкий процесс бонус не вытаскивает
  assert.ok(!chooseProcesses(0.33, 0.69, 'push_montage').some((x) => x.id === 'push_montage'));
});

// ---------- ритм ----------
test('ритм: длина кадра по темпу, проявка и переход по энергии', () => {
  const hold = (bpm: number) => buildRecipe(input({ music: music(bpm) })).rhythm.frameHoldBars;
  assert.equal(hold(72), 1);
  assert.equal(hold(90), 0.5);
  assert.equal(hold(120), 0.5);
  assert.equal(hold(128), 0.25);

  const at = (energy: number) => buildRecipe(input({ overrides: { energy } })).rhythm;
  assert.deepEqual(at(0.3), { developBars: 4, frameHoldBars: 0.5, transition: 'dissolve' });
  assert.deepEqual(at(0.5), { developBars: 3, frameHoldBars: 0.5, transition: 'dissolve' });
  assert.deepEqual(at(0.7), { developBars: 2, frameHoldBars: 0.5, transition: 'dissolve' });
  assert.deepEqual(at(0.75), { developBars: 2, frameHoldBars: 0.5, transition: 'cut' });
  assert.equal(buildRecipe(input({ music: music(72) })).music.barSeconds, 3.333);
});

// ---------- композиция ----------
test('композиция по числу кадров, близости и энергии', () => {
  const photos = (n: number) => Array.from({ length: n }, () => ({ palette: ['#808080'] }));
  const comp = (n: number, together: number, energy: number) =>
    buildRecipe(input({
      photos: photos(n),
      analysis: analysis({ atmosphere: { energy: 0.5, tone: 0.6, together, special: 0.3 } }),
      overrides: { energy },
    })).composition;
  assert.equal(comp(1, 0.9, 0.9), 'single');
  assert.equal(comp(2, 0.7, 0.5), 'diptych');
  assert.equal(comp(2, 0.5, 0.5), 'sequence');
  assert.equal(comp(3, 0.5, 0.8), 'strip');
  assert.equal(comp(4, 0.5, 0.5), 'sequence');
  assert.equal(comp(5, 0.5, 0.5), 'contact_sheet');
});

// ---------- цвет и свет ----------
test('противоречие включает сплит-тон: холодные тени, тёплые света', () => {
  assert.equal(buildRecipe(input()).splitTone, undefined);
  const r = buildRecipe(input({ analysis: analysis({ contrast: { has: true, cold: 'холодно', warm: 'какао' } }) }));
  assert.ok(r.splitTone);
  const blue = (hex: string) => parseInt(hex.slice(5, 7), 16) - parseInt(hex.slice(1, 3), 16);
  assert.ok(blue(r.splitTone!.shadows) > 0, 'тени уходят в синий');
  assert.ok(blue(r.splitTone!.highlights) < 0, 'света уходят в янтарь');
  assert.ok(r.why.some((w) => w.includes('холодно, но какао')));
});

test('палитра только из фото; свет вечером теплее, чем ночью', () => {
  const r = buildRecipe(input());
  assert.deepEqual(r.palette, ['#203040', '#c08040', '#808080']);
  const night = buildRecipe(input({ analysis: analysis({ timeOfDay: 'night' }) }));
  assert.ok(r.light.warmth > night.light.warmth);
});

test('воздух: плотность 0 без частиц', () => {
  assert.deepEqual(buildRecipe(input()).air, { particles: [], density: 0 });
  const r = buildRecipe(input({ analysis: analysis({ air: ['steam', 'leaves', 'steam'] }) }));
  assert.deepEqual(r.air.particles, ['steam', 'leaves']);
  assert.ok(r.air.density > 0);
});

// ---------- why ----------
test('why: 3–5 строк, первая — про темп, есть строка про процесс', () => {
  const r = buildRecipe(input({ music: music(72) }));
  assert.ok(r.why.length >= 3 && r.why.length <= 5);
  assert.match(r.why[0], /^72 BPM: кадр держится такт, мягкие наплывы$/);
  assert.ok(r.why.some((w) => w.includes('автохром') || w.includes('цианотипия')));
  const many = buildRecipe(input({
    music: music(128),
    photos: Array.from({ length: 6 }, () => ({ palette: ['#808080'] })),
    analysis: analysis({ contrast: { has: true, cold: 'холодно', warm: 'какао' }, atmosphere: { energy: 0.9, tone: 0.2, together: 0.9, special: 0.9 } }),
  }));
  assert.equal(many.why.length, 5);
});

test('рецепт детерминирован', () => {
  assert.deepEqual(buildRecipe(input()), buildRecipe(input()));
});

// ---------- проверки §4.4 ----------
test('подпись: дословно, без учёта регистра и лишних пробелов, с исходным написанием', () => {
  const ok = checkCaption('ПИЛИ   какао в  парке', TEXT);
  assert.equal(ok.replaced, false);
  assert.equal(ok.caption, 'пили какао в парке');
  const yo = checkCaption('Листья шуршали под ногами', 'Листья шуршали под ногами. Всё.');
  assert.equal(yo.caption, 'Листья шуршали под ногами');
  const ee = checkCaption('ещё горячее', 'Какао было ещё горячее');
  assert.equal(ee.replaced, false);
  assert.equal(checkCaption('еще горячее', 'Какао было ещё горячее').caption, 'ещё горячее');
});

test('подпись: не из текста или не 2–6 слов → берём из самого чувственного предложения', () => {
  const missing = checkCaption('пили горячий шоколад', TEXT);
  assert.equal(missing.replaced, true);
  assert.equal(missing.reason, 'такой фразы нет в тексте дословно');
  assert.ok(TEXT.toLowerCase().includes(missing.caption.toLowerCase()));
  const long = checkCaption('Было холодно, но мы пили какао в парке', TEXT);
  assert.equal(long.replaced, true);
  assert.match(long.reason ?? '', /8 слов/);
});

test('название: 3–7 слов, без эмоций в лоб, эмодзи и точки', () => {
  assert.equal(folderNameIssue('Осенний парк и какао'), null);
  assert.match(folderNameIssue('Парк') ?? '', /1 слов/);
  assert.match(folderNameIssue('Самый счастливый вечер в парке') ?? '', /счастливый/);
  assert.match(folderNameIssue('Лучший день с мамой') ?? '', /Лучший/);
  assert.equal(folderNameIssue('Парк и какао с мамой 🍫'), 'эмодзи');
  assert.equal(folderNameIssue('Осенний парк и какао.'), 'точка в конце');
  assert.match(folderNameIssue('Ночь: офис/дедлайн и кофе') ?? '', /недопустимый/);

  const pick = checkFolderNames(['Грустный вечер дома', 'Вечер.', '«Какао у окна вечером»'], '2026-11-19');
  assert.equal(pick.name, 'Какао у окна вечером');
  assert.equal(pick.chosenIndex, 2);
  assert.equal(pick.rejected.length, 2);
  assert.equal(checkFolderNames(['😀'], '2026-11-19').name, 'Страница дня 19.11');
});
