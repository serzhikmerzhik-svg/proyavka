/** Озвучка (SPEC §8): выбор провайдера, голос под атмосферу, нарезка длинного текста. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TtsRequestSchema, resolveTts, splitForTts, voiceFor } from '../src/tts.js';

test('провайдер озвучки из .env; без ключа — выключено с причиной', () => {
  const none = resolveTts({});
  assert.equal(none.provider, null);
  assert.equal(none.reason, 'ключ для озвучки не задан');
  assert.equal(resolveTts({ OPENAI_API_KEY: 'test-key' }).provider?.model, 'gpt-4o-mini-tts');
  assert.equal(resolveTts({ OPENAI_API_KEY: 'test-key', TTS_MODEL: 'gpt-4o-mini-tts-2025-12-15' }).provider?.model, 'gpt-4o-mini-tts-2025-12-15');
  assert.equal(resolveTts({ TTS_PROVIDER: 'none', OPENAI_API_KEY: 'test-key' }).provider, null);
  const yandex = resolveTts({ TTS_PROVIDER: 'yandex' });
  assert.equal(yandex.provider, null);
  assert.match(yandex.reason ?? '', /Yandex/);
});

test('голос подбирается под атмосферу', () => {
  assert.equal(voiceFor({ energy: 0.2, tone: 0.8 }), 'sage');
  assert.equal(voiceFor({ energy: 0.2, tone: 0.2 }), 'ballad');
  assert.equal(voiceFor({ energy: 0.9, tone: 0.2 }), 'ash');
  assert.equal(voiceFor({ energy: 0.5, tone: 0.5 }), 'coral');
});

test('длинный текст режется по предложениям в пределах лимита, ничего не теряя', () => {
  const sentence = 'Мы долго гуляли по парку и пили какао. ';
  const text = sentence.repeat(300);
  const parts = splitForTts(text, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join(' '), text.replace(/\s+/g, ' ').trim());
});

test('запрос: стиль и скорость из recipe.voice, скорость в разумных пределах', () => {
  assert.ok(TtsRequestSchema.safeParse({ text: 'Привет', style: 'тепло', speed: 0.96 }).success);
  assert.ok(!TtsRequestSchema.safeParse({ text: '', style: 'тепло', speed: 1 }).success);
  assert.ok(!TtsRequestSchema.safeParse({ text: 'Привет', speed: 5 }).success);
});
