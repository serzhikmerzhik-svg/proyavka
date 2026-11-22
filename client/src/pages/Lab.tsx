/**
 * /lab — проверка визуальной системы (SPEC §7.8): одно фото, проявленное всеми девятью процессами
 * в сетке 3 × 3, и смешивание двух процессов по весам. Рамка, штамп и подпись — те же, что у дней.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PrintRenderer, loadImage } from '../render/renderer';
import { processParams } from '../render/params';
import { computeLayout, drawPrint, drawTable, ensureFonts } from '../render/compositor';
import { makeTestChart } from '../render/testChart';
import { PROCESS_IDS, PROCESS_NAMES } from '../recipe/presets';
import { listDays } from '../storage/db';
import { ThemePicker } from '../ui/theme';
import type { Day, ProcessId } from '../recipe/types';

const TILE = { w: 300, h: 390 };
const BIG = { w: 420, h: 546 };
const BPM = 100;

type Settings = { develop: number; live: boolean; a: ProcessId; b: ProcessId; w: number };

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function Lab() {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [source, setSource] = useState('тестовая таблица');
  const [days, setDays] = useState<Day[]>([]);
  const [settings, setSettings] = useState<Settings>({ develop: 1, live: false, a: 'autochrome', b: 'cyanotype', w: 0.35 });
  const [error, setError] = useState<string>();

  const tiles = useRef<(HTMLCanvasElement | null)[]>([]);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    listDays().then(setDays).catch(() => setDays([]));
    makeTestChart().then(setImg).catch((e) => setError((e as Error).message));
  }, []);

  // Два рендерера на всю страницу (сетка и большой кадр смешивания) — WebGL-контексты не плодим.
  useEffect(() => {
    if (!img) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tileLayout = computeLayout(TILE.w * dpr, TILE.h * dpr, 0.05);
    const bigLayout = computeLayout(BIG.w * dpr, BIG.h * dpr, 0.05);
    const small = new PrintRenderer(tileLayout.photoW, tileLayout.photoH);
    const large = new PrintRenderer(bigLayout.photoW, bigLayout.photoH);
    small.setPhotos(img, img, img);
    large.setPhotos(img, img, img);
    const date = new Date().toLocaleDateString('sv-SE');
    const t0 = performance.now();
    let disposed = false;
    let raf = 0;

    const draw = () => {
      if (disposed) return;
      cancelAnimationFrame(raf);
      const s = settingsRef.current;
      const t = (performance.now() - t0) / 1000;
      const phase = (t * BPM) / 60;
      const frame = {
        time: t,
        develop: s.develop,
        beat: s.live ? Math.exp(-(phase % 1) * 5) : 0,
        seed: s.live ? Math.floor(phase) : 0,
        rms: s.live ? 0.5 + 0.15 * Math.sin(t * 2.1) : 0.5,
        mix: 0,
      };

      PROCESS_IDS.forEach((id, i) => {
        const canvas = tiles.current[i];
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        small.setParams(processParams([{ id, weight: 1 }]));
        small.render(frame);
        drawTable(ctx, canvas.width, canvas.height);
        drawPrint(ctx, tileLayout, small.canvas, { caption: PROCESS_NAMES[id], date, develop: s.develop, safelight: 0 });
      });

      const big = bigRef.current;
      if (big) {
        const ctx = big.getContext('2d')!;
        large.setParams(processParams([{ id: s.a, weight: 1 - s.w }, { id: s.b, weight: s.w }]));
        large.render(frame);
        drawTable(ctx, big.width, big.height);
        const caption = `${PROCESS_NAMES[s.a]} ${pct(1 - s.w)} · ${PROCESS_NAMES[s.b]} ${pct(s.w)}`;
        drawPrint(ctx, bigLayout, large.canvas, { caption, date, develop: s.develop, safelight: 0 });
      }
      if (s.live) raf = requestAnimationFrame(draw);
    };
    drawRef.current = draw;
    ensureFonts().then(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      drawRef.current = () => {};
      small.dispose();
      large.dispose();
    };
  }, [img]);

  // любое изменение настроек — перерисовка (в живом режиме цикл уже идёт)
  useEffect(() => {
    drawRef.current();
  }, [settings]);

  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  async function pickDay(id: string) {
    const day = days.find((d) => d.id === id);
    const photo = day?.photos[day.recipe.bestPhotoIndex] ?? day?.photos[0];
    if (!day || !photo) return;
    setImg(await loadImage(photo.blob));
    setSource(`кадр дня «${day.folderName}»`);
  }

  async function pickFile(file?: File) {
    if (!file) return;
    try {
      setImg(await loadImage(file));
      setSource(file.name);
    } catch {
      setError('Не удалось открыть файл как изображение');
    }
  }

  async function pickChart() {
    setImg(await makeTestChart());
    setSource('тестовая таблица');
  }

  const processOptions = PROCESS_IDS.map((id) => (
    <option key={id} value={id}>{PROCESS_NAMES[id]}</option>
  ));

  return (
    <main className="page lab">
      <header className="topbar">
        <Link to="/#archive" className="mono">← контактный лист</Link>
        <h1>Лаборатория</h1>
        <div className="topbar-actions">
          <Link to="/lab/music" className="mono">темп и тональность →</Link>
          <ThemePicker />
        </div>
      </header>

      <section className="lab-controls">
        <div className="row">
          <button className="btn ghost small" onClick={() => void pickChart()}>Тестовая таблица</button>
          {days.length > 0 && (
            <select defaultValue="" onChange={(e) => e.target.value && void pickDay(e.target.value)}>
              <option value="" disabled>Кадр из архива…</option>
              {days.map((d) => (
                <option key={d.id} value={d.id}>{d.date} · {d.folderName}</option>
              ))}
            </select>
          )}
          <label className="btn ghost small">
            Своё фото
            <input type="file" accept="image/*" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
          <span className="mono small dim">источник: {source}</span>
        </div>
        <div className="row">
          <label className="mood-axis mono small">
            проявка
            <input type="range" min={0} max={1} step={0.01} value={settings.develop} onChange={(e) => set({ develop: Number(e.target.value) })} />
            {pct(settings.develop)}
          </label>
          <label className="check mono small">
            <input type="checkbox" checked={settings.live} onChange={(e) => set({ live: e.target.checked })} />
            живое: доли {BPM} BPM — новое зерно и сдвиг трихрома на каждой доле
          </label>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="lab-grid" aria-label="Девять процессов">
        {PROCESS_IDS.map((id, i) => (
          <figure key={id} className="lab-tile">
            <canvas
              ref={(el) => { tiles.current[i] = el; }}
              width={TILE.w * Math.min(window.devicePixelRatio || 1, 2)}
              height={TILE.h * Math.min(window.devicePixelRatio || 1, 2)}
            />
            <figcaption className="mono small dim">{id}</figcaption>
          </figure>
        ))}
      </section>

      <section className="lab-blend">
        <canvas
          ref={bigRef}
          width={BIG.w * Math.min(window.devicePixelRatio || 1, 2)}
          height={BIG.h * Math.min(window.devicePixelRatio || 1, 2)}
        />
        <div className="lab-blend-controls">
          <h2 className="mono">Смешивание по весам</h2>
          <p className="mono small dim">Как в рецепте: два процесса, веса в сумме 1, параметры смешиваются на CPU.</p>
          <select value={settings.a} onChange={(e) => set({ a: e.target.value as ProcessId })}>{processOptions}</select>
          <select value={settings.b} onChange={(e) => set({ b: e.target.value as ProcessId })}>{processOptions}</select>
          <label className="mood-axis mono small">
            {pct(1 - settings.w)}
            <input type="range" min={0} max={1} step={0.05} value={settings.w} onChange={(e) => set({ w: Number(e.target.value) })} />
            {pct(settings.w)}
          </label>
        </div>
      </section>
    </main>
  );
}
