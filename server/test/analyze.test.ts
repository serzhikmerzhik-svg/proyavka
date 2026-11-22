/**
 * Повтор и откат /api/analyze на подставных провайдерах — без сети и ключей.
 * Запуск: npm test -w server
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDay } from '../src/analyze.js';
import { resolveProvider } from '../src/llm/index.js';
import { LlmError, type LlmProvider, type LlmRequest } from '../src/llm/provider.js';
import { parseAnalysis } from '../src/llm/schema.js';
import { AnalyzeRequestSchema } from '../src/types.js';

const req = AnalyzeRequestSchema.parse({
  text: 'Было холодно, но мы с мамой пили какао в осеннем парке. Листья шуршали под ногами.',
  date: '2026-11-19',
  photoCount: 2,
  song: { title: 'The Scientist', artist: 'Coldplay', year: 2002 },
});

const good = {
  atmosphere: { energy: 0.25, tone: 0.72, together: 0.85, special: 0.4 },
  label: 'autochrome',
  timeOfDay: 'evening',
  season: 'autumn',
  contrast: { has: true, cold: 'холодно', warm: 'какао' },
  air: ['steam', 'leaves', 'steam'],
  captionQuote: 'Листья шуршали под ногами',
  folderNames: ['Осенний парк и какао', 'Какао с мамой в парке', 'Вечер в осеннем парке', 'Листья и горячее какао', 'Парк, мама и какао'],
  voiceStyle: 'Говори тихо и тепло, чуть медленнее обычного.',
  bestPhotoIndex: 1,
  photoNotes: [
    { index: 0, scene: 'аллея с жёлтыми листьями', people: false },
    { index: 1, scene: 'две кружки какао на скамейке', people: true },
  ],
};

/** Отдаёт заранее заданные ответы по очереди и запоминает запросы. */
class FakeProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  readonly model = 'fake-model';
  calls: LlmRequest[] = [];
  constructor(private replies: (string | Error)[]) {}
  async complete(r: LlmRequest): Promise<string> {
    this.calls.push(r);
    const next = this.replies.shift();
    if (next === undefined) throw new Error('лишний вызов');
    if (next instanceof Error) throw next;
    return next;
  }
}

test('без провайдера — эвристика, модель не вызывается', async () => {
  const r = await analyzeDay(req, null, 'ключ модели не задан');
  assert.equal(r.source, 'heuristic');
  assert.equal(r.attempts, 0);
  assert.equal(r.fallbackReason, 'ключ модели не задан');
  assert.ok(r.analysis.folderNames.length > 0);
});

test('валидный ответ с первой попытки', async () => {
  const p = new FakeProvider([JSON.stringify(good)]);
  const r = await analyzeDay(req, p);
  assert.equal(r.source, 'llm');
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.analysis.air, ['steam', 'leaves']); // дубли убраны
  assert.equal(p.calls[0].feedback, undefined);
  assert.match(p.calls[0].text, /<текст_дня>[\s\S]*какао[\s\S]*<\/текст_дня>/);
});

test('битый JSON → один повтор с описанием ошибки → успех', async () => {
  const p = new FakeProvider(['{"atmosphere": ', JSON.stringify(good)]);
  const r = await analyzeDay(req, p);
  assert.equal(r.source, 'llm');
  assert.equal(r.attempts, 2);
  assert.match(p.calls[1].feedback ?? '', /не является корректным JSON/);
});

test('ось вне 0..1 → повтор называет поле', async () => {
  const bad = { ...good, atmosphere: { ...good.atmosphere, energy: 1.4 } };
  const p = new FakeProvider([JSON.stringify(bad), JSON.stringify(good)]);
  const r = await analyzeDay(req, p);
  assert.equal(r.attempts, 2);
  assert.match(p.calls[1].feedback ?? '', /atmosphere\.energy/);
});

test('два неудачных ответа → эвристика, третьего запроса нет', async () => {
  const p = new FakeProvider(['нет', '{}']);
  const r = await analyzeDay(req, p);
  assert.equal(r.source, 'heuristic');
  assert.equal(r.attempts, 2);
  assert.equal(p.calls.length, 2);
  assert.match(r.fallbackReason ?? '', /не прошёл проверку/);
});

test('сбой сети → повтор того же запроса без feedback', async () => {
  const p = new FakeProvider([new LlmError('нет связи', 'transient', true), JSON.stringify(good)]);
  const r = await analyzeDay(req, p, undefined, { retryDelayMs: 0 });
  assert.equal(r.source, 'llm');
  assert.equal(r.attempts, 2);
  assert.equal(p.calls[1].feedback, undefined);
});

test('неверный ключ → сразу эвристика, без повтора', async () => {
  const p = new FakeProvider([new LlmError('нет доступа', 'auth', false)]);
  const r = await analyzeDay(req, p);
  assert.equal(r.source, 'heuristic');
  assert.equal(r.attempts, 1);
  assert.equal(r.fallbackReason, 'нет доступа');
});

test('отказ модели → эвристика без повтора', async () => {
  const p = new FakeProvider([new LlmError('модель отказалась', 'refusal', false)]);
  const r = await analyzeDay(req, p);
  assert.equal(r.source, 'heuristic');
  assert.equal(p.calls.length, 1);
});

test('нормализация: пустой контраст, кадр вне диапазона, чужие photoNotes', () => {
  const raw = JSON.stringify({
    ...good,
    contrast: { has: true, cold: 'холодно', warm: '' },
    bestPhotoIndex: 7,
    photoNotes: [...good.photoNotes, { index: 5, scene: 'лишний', people: false }],
  });
  const r = parseAnalysis(raw, 2);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.analysis.contrast, { has: false });
  assert.equal(r.analysis.bestPhotoIndex, 1);
  assert.equal(r.analysis.photoNotes.length, 2);
});

test('выбор провайдера из .env', () => {
  assert.equal(resolveProvider({}).provider, null);
  assert.equal(resolveProvider({ LLM_PROVIDER: 'none', ANTHROPIC_API_KEY: 'x' }).provider, null);

  const a = resolveProvider({ ANTHROPIC_API_KEY: 'test-key' }).provider;
  assert.equal(a?.id, 'anthropic');
  assert.equal(a?.model, 'claude-opus-5-5');

  const a2 = resolveProvider({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'claude-sonnet-5-5' });
  assert.equal(a2.provider?.model, 'claude-sonnet-5-5');

  const o = resolveProvider({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }).provider;
  assert.equal(o?.id, 'openai');

  const unknown = resolveProvider({ LLM_PROVIDER: 'gemini' });
  assert.equal(unknown.provider, null);
  assert.match(unknown.reason ?? '', /неизвестный/);
});

test('кадры для модели проверяются схемой запроса', () => {
  const ok = AnalyzeRequestSchema.safeParse({ ...req, photos: [{ mediaType: 'image/jpeg', data: 'QUJDREVGR0hJSktMTU5PUA==' }] });
  assert.ok(ok.success);
  const bad = AnalyzeRequestSchema.safeParse({ ...req, photos: [{ mediaType: 'image/png', data: 'not base64!' }] });
  assert.ok(!bad.success);
});
