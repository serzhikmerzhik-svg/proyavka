import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages отдаёт сайт из подпапки: BASE_PATH=/<репозиторий>/ (см. .github/workflows/pages.yml)
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  // воркер глубины — ES-модуль: transformers.js подгружает onnxruntime динамическим import
  worker: { format: 'es' },
  // onnxruntime-web тянет .wasm сам; пребандлинг Vite ему мешает
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: true },
    },
  },
});
