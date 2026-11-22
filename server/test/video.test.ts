/** ИИ-оживление (опция): JWT Kling, выбор провайдера, запросы и статусы — на подставном fetch, без сети. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AnimateRequestSchema, buildMotionPrompt, createKling, klingJwt, resolveVideo } from '../src/video.js';

const KEYS = { VIDEO_PROVIDER: 'kling', KLING_ACCESS_KEY: 'ak-test', KLING_SECRET_KEY: 'sk-test' };

test('JWT для Kling: HS256, iss = Access Key, срок 30 минут, nbf на 5 с раньше', () => {
  const now = 1_800_000_000;
  const [h, p, s] = klingJwt('ak-test', 'sk-test', now).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString()), { iss: 'ak-test', exp: now + 1800, nbf: now - 5 });
  assert.equal(s, crypto.createHmac('sha256', 'sk-test').update(`${h}.${p}`).digest('base64url'));
});

test('опция выключена по умолчанию — даже при наличии ключей', () => {
  assert.equal(resolveVideo({}).provider, null);
  assert.equal(resolveVideo({ KLING_ACCESS_KEY: 'a', KLING_SECRET_KEY: 'b' }).provider, null);
  const noKeys = resolveVideo({ VIDEO_PROVIDER: 'kling' });
  assert.equal(noKeys.provider, null);
  assert.match(noKeys.reason ?? '', /KLING_ACCESS_KEY/);
  const on = resolveVideo(KEYS).provider;
  assert.equal(on?.id, 'kling');
  assert.equal(on?.model, 'kling-v2-6');
});

test('промпт — синемаграф: неподвижная камера, двигаются только детали из рецепта', () => {
  const { prompt, negative } = buildMotionPrompt(['steam', 'leaves']);
  assert.match(prompt, /Static locked-off camera/);
  assert.match(prompt, /steam/);
  assert.match(prompt, /leaves/);
  assert.match(negative, /camera movement/);
  assert.match(negative, /new people/);
});

type Call = { url: string; init?: RequestInit };
function fakeFetch(responses: { status: number; body: unknown }[], calls: Call[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

test('создание задачи: JWT в заголовке, тело по API Kling, task_id в ответе', async () => {
  const calls: Call[] = [];
  const kling = createKling(KEYS, fakeFetch([{ status: 200, body: { code: 0, message: 'SUCCEED', data: { task_id: 'task-1', task_status: 'submitted' } } }], calls));
  const id = await kling.create('QUJD', 'prompt', 'negative');
  assert.equal(id, 'task-1');
  assert.equal(calls[0].url, 'https://api.klingai.com/v1/videos/image2video');
  assert.equal(calls[0].init?.method, 'POST');
  assert.match(String((calls[0].init?.headers as Record<string, string>).Authorization), /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    model_name: 'kling-v2-6', image: 'QUJD', prompt: 'prompt', negative_prompt: 'negative', mode: 'std', duration: '5',
  });
});

test('статусы Kling → состояния: в очереди, идёт, готово со ссылкой, ошибка', async () => {
  const calls: Call[] = [];
  const kling = createKling(KEYS, fakeFetch([
    { status: 200, body: { code: 0, data: { task_status: 'submitted' } } },
    { status: 200, body: { code: 0, data: { task_status: 'processing' } } },
    { status: 200, body: { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ id: 'v', url: 'https://cdn.example/v.mp4', duration: '5' }] } } } },
    { status: 200, body: { code: 0, data: { task_status: 'failed', task_status_msg: 'контент отклонён' } } },
  ], calls));
  assert.deepEqual(await kling.status('t'), { state: 'queued' });
  assert.deepEqual(await kling.status('t'), { state: 'running' });
  assert.deepEqual(await kling.status('t'), { state: 'done', videoUrl: 'https://cdn.example/v.mp4' });
  assert.deepEqual(await kling.status('t'), { state: 'failed', error: 'контент отклонён' });
  assert.equal(calls[0].url, 'https://api.klingai.com/v1/videos/image2video/t');
});

test('ошибки Kling: ключи, лимит, бизнес-код', async () => {
  const mk = (status: number, body: unknown) => createKling(KEYS, fakeFetch([{ status, body }], []));
  await assert.rejects(mk(401, { code: 1000, message: 'auth' }).create('QUJD', 'p', 'n'), (e: Error & { httpStatus?: number }) => /ключи/.test(e.message) && e.httpStatus === 502);
  await assert.rejects(mk(429, { code: 1302 }).create('QUJD', 'p', 'n'), (e: Error & { httpStatus?: number }) => e.httpStatus === 429);
  await assert.rejects(mk(200, { code: 1102, message: 'balance not enough' }).create('QUJD', 'p', 'n'), /balance not enough/);
});

test('запрос: кадр только base64 без префикса, частицы — из списка', () => {
  const img = 'A'.repeat(200);
  assert.ok(AnimateRequestSchema.safeParse({ image: img, air: ['steam'] }).success);
  assert.ok(!AnimateRequestSchema.safeParse({ image: `data:image/jpeg;base64,${img}` }).success);
  assert.ok(!AnimateRequestSchema.safeParse({ image: img, air: ['lava'] }).success);
});
