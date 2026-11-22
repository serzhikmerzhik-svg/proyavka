import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeHandler } from './analyze.js';
import { previewHandler, searchHandler, trackHandler } from './music.js';
import { getProvider } from './llm/index.js';
import { getTts, ttsHandler } from './tts.js';
import { animateCreateHandler, animateStatusHandler, animateVideoHandler, getVideo } from './video.js';

// .env из корня монорепо (необязателен)
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, '../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_req, res) => {
  const { provider, reason } = getProvider();
  const tts = getTts();
  const video = getVideo();
  res.json({
    ok: true,
    llm: provider ? { provider: provider.id, model: provider.model } : null,
    analysis: provider ? 'llm' : 'heuristic',
    reason,
    tts: tts.provider ? { provider: tts.provider.id, model: tts.provider.model } : null,
    ttsReason: tts.reason,
    video: video.provider ? { provider: video.provider.id, model: video.provider.model } : null,
    videoReason: video.reason,
  });
});
app.post('/api/analyze', analyzeHandler);
app.post('/api/tts', ttsHandler);
app.post('/api/animate', animateCreateHandler);
app.get('/api/animate/:taskId', animateStatusHandler);
app.get('/api/animate/:taskId/video', animateVideoHandler);
app.get('/api/music/search', searchHandler);
app.get('/api/music/track', trackHandler);
app.get('/api/music/preview', previewHandler);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Нет такого API' });
});

// Продакшен: тот же процесс раздаёт собранный клиент.
// dev = запуск из исходников через tsx; там клиент раздаёт Vite
const isDev = import.meta.url.endsWith('.ts');
const clientDist = path.resolve(here, '../../client/dist');
if (!isDev && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// В dev PORT часто занят окружением под Vite — API слушает API_PORT. В продакшене — PORT хостинга.
const port = Number(isDev ? process.env.API_PORT : process.env.PORT) || 8787;
app.listen(port, () => console.log(`[proyavka] API на http://localhost:${port}`));
