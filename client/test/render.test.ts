/**
 * Визуальная система (SPEC §6): пресеты девяти процессов, смешивание по весам и сверка
 * вектора параметров с униформами шейдера. Запуск: npm test -w client
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, PROCESS_IDS, blendPresets } from '../src/recipe/presets';
import { processParams, resolveParams, uniformName } from '../src/render/params';
import { buildRecipe } from '../src/recipe/buildRecipe';
import type { MusicFeatures, TextAnalysis } from '../src/recipe/types';

const shader = readFileSync(new URL('../src/render/shaders/print.frag.glsl', import.meta.url), 'utf8');

test('девять процессов, у каждого своя отличительная черта', () => {
  assert.equal(PROCESS_IDS.length, 9);
  const P = PRESETS;
  assert.equal(P.autochrome.autochrome, 1);
  assert.ok(P.cyanotype.cyanotype === 1 && P.cyanotype.monochrome === 1);
  assert.ok(P.kodachrome.saturation > 1 && P.kodachrome.warmBoost > 0 && P.kodachrome.shadowDensity > 0);
  assert.ok(P.instant.lift > 0.1 && P.instant.flash > 0 && P.instant.toneAmount > 0);
  assert.ok(P.instant.toneShadows[2] > P.instant.toneShadows[0], 'тени моментального фото — циановые');
  assert.ok(P.instant.toneHighlights[0] > P.instant.toneHighlights[2], 'света — тёплые');
  assert.equal(P.trichrome.trichrome, 1);
  assert.ok(P.push_montage.monochrome === 1 && P.push_montage.sCurve === 1 && P.push_montage.grid === 1);
  assert.ok(P.push_montage.grainSize > P.autochrome.grainSize && P.push_montage.grainAmount >= 0.4, 'крупное зерно');
  assert.equal(P.double_exposure.doubleExposure, 1);
  assert.ok(P.platinum.monochrome === 1 && P.platinum.contrast < 1 && P.platinum.toneAmount > 0);
  assert.equal(P.solarization.solarize, 1);
  // монохромные процессы — без цветного зерна
  for (const id of PROCESS_IDS) if (PRESETS[id].monochrome === 1) assert.equal(PRESETS[id].grainChroma, 0, id);
});

test('смешивание двух процессов: числа линейно по весам', () => {
  const b = blendPresets([{ id: 'autochrome', weight: 0.65 }, { id: 'cyanotype', weight: 0.35 }]);
  assert.ok(Math.abs(b.autochrome - 0.65) < 1e-9);
  assert.ok(Math.abs(b.cyanotype - 0.35) < 1e-9);
  assert.ok(Math.abs(b.monochrome - 0.35) < 1e-9);
  const c = 0.65 * PRESETS.autochrome.contrast + 0.35 * PRESETS.cyanotype.contrast;
  assert.ok(Math.abs(b.contrast - c) < 1e-9);
  // чистый процесс = его пресет
  assert.deepEqual(blendPresets([{ id: 'kodachrome', weight: 1 }]), PRESETS.kodachrome);
});

test('тонирование: процесс без тона не разбавляет цвет серым, а только ослабляет силу', () => {
  const b = blendPresets([{ id: 'platinum', weight: 0.5 }, { id: 'solarization', weight: 0.5 }]);
  PRESETS.platinum.toneShadows.forEach((v, i) => assert.ok(Math.abs(b.toneShadows[i] - v) < 1e-9));
  assert.ok(Math.abs(b.toneAmount - PRESETS.platinum.toneAmount * 0.5) < 1e-9);
  const none = blendPresets([{ id: 'autochrome', weight: 0.5 }, { id: 'trichrome', weight: 0.5 }]);
  assert.equal(none.toneAmount, 0);
});

test('каждый параметр вектора объявлен униформой в шейдере', () => {
  const params = processParams([{ id: 'autochrome', weight: 1 }]);
  for (const [key, value] of Object.entries(params)) {
    const type = Array.isArray(value) ? 'vec3' : 'float';
    assert.match(shader, new RegExp(`uniform ${type} ${uniformName(key)};`), `нет униформы для ${key}`);
  }
  for (const u of ['uPhotoA', 'uPhotoB', 'uPhotoC', 'uDevelop', 'uBeat', 'uRms', 'uSeed', 'uTime', 'uMix']) {
    assert.match(shader, new RegExp(`uniform \\w+ ${u};`), u);
  }
});

test('рецепт поверх процесса: особенность, ночь, противоречие', () => {
  const music: MusicFeatures = { bpm: 72, beatOffset: 0, barSeconds: 240 / 72, rmsEnvelope: [], rmsMean: 0.5, brightness: 0.5, key: 'C', mode: 'major', modeConfidence: 0.5 };
  const analysis = (o: Partial<TextAnalysis>): TextAnalysis => ({
    atmosphere: { energy: 0.3, tone: 0.7, together: 0.5, special: 0.2 }, label: 'autochrome', timeOfDay: 'day', season: 'autumn',
    contrast: { has: false }, air: [], captionQuote: 'пили какао', folderNames: ['Осенний парк и какао'], voiceStyle: '',
    bestPhotoIndex: 0, photoNotes: [], ...o,
  });
  const recipe = (o: Partial<TextAnalysis>) => buildRecipe({
    text: 'Холодно, но пили какао.', date: '2026-11-19', analysis: analysis(o), music, photos: [{ palette: ['#203040', '#c08040'] }],
  });
  const plain = resolveParams(recipe({}));
  const special = resolveParams(recipe({ atmosphere: { energy: 0.3, tone: 0.7, together: 0.5, special: 0.9 } }));
  assert.ok(special.grainAmount > plain.grainAmount && special.halation > plain.halation && special.fade > plain.fade);
  const night = resolveParams(recipe({ timeOfDay: 'night' }));
  assert.equal(night.lowKey, 1);
  assert.ok(night.halation > plain.halation);
  const split = resolveParams(recipe({ contrast: { has: true, cold: 'холодно', warm: 'какао' } }));
  assert.ok(split.splitAmount > 0 && plain.splitAmount === 0);
});
