/**
 * Компоновщик: финальный кадр на 2D-canvas — бумага с фигурным краем, WebGL-слой, штамп даты, подпись.
 * Постоянная рамка одинакова у всех дней (SPEC §6).
 */
import dsegUrl from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2?url';
import { FRAME_ASPECT } from './renderer';

export const COLORS = {
  lab: '#0f0d0c',
  paper: '#f3efe6',
  safelight: '#b3261e',
  stamp: '#ff8a1f',
  ink: '#2b2622',
};

let fontsReady: Promise<void> | null = null;
/** DSEG7 грузим через FontFace (путь из npm-пакета dseg), Caveat — из @fontsource. */
export function ensureFonts(): Promise<void> {
  fontsReady ??= (async () => {
    try {
      const face = new FontFace('DSEG7', `url(${dsegUrl})`);
      document.fonts.add(await face.load());
    } catch (e) {
      console.warn('DSEG7 не загрузился, штамп будет моноширинным', e);
    }
    await Promise.all([document.fonts.load('32px Caveat'), document.fonts.load('16px "JetBrains Mono"')]);
  })();
  return fontsReady;
}

export type PrintLayout = {
  printX: number; printY: number; printW: number; printH: number;
  photoX: number; photoY: number; photoW: number; photoH: number;
  margin: number;
};

const SIDE = 0.06; // поле сбоку и сверху, доля ширины отпечатка
const BOTTOM = 0.22; // нижнее поле под подпись
const PRINT_H_RATIO = SIDE + (1 - 2 * SIDE) / FRAME_ASPECT + BOTTOM; // высота / ширина

export function computeLayout(W: number, H: number, pad = 0.06): PrintLayout {
  const availW = W * (1 - 2 * pad);
  const availH = H * (1 - 2 * pad);
  const printW = Math.min(availW, availH / PRINT_H_RATIO);
  const printH = printW * PRINT_H_RATIO;
  const printX = (W - printW) / 2;
  const printY = (H - printH) / 2;
  const margin = printW * SIDE;
  const photoW = printW - 2 * margin;
  return {
    printX, printY, printW, printH,
    photoX: printX + margin, photoY: printY + margin, photoW, photoH: photoW / FRAME_ASPECT,
    margin,
  };
}

/** Фигурный («зубчатый») край фотобумаги — мелкие фестоны по периметру. */
function deckledPath(L: PrintLayout): Path2D {
  const path = new Path2D();
  const { printX: x, printY: y, printW: w, printH: h } = L;
  const step = w * 0.022;
  const amp = w * 0.0045;
  const side = (x0: number, y0: number, x1: number, y1: number, first: boolean) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / step));
    const nx = (y1 - y0) / len; // нормаль наружу (обход по часовой)
    const ny = -(x1 - x0) / len;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      if (i === 0 && first) path.moveTo(px, py);
      else if (i > 0) {
        const mt = (i - 0.5) / n;
        path.quadraticCurveTo(
          x0 + (x1 - x0) * mt - nx * amp * 2, y0 + (y1 - y0) * mt - ny * amp * 2,
          px, py,
        );
      }
    }
  };
  side(x, y, x + w, y, true);
  side(x + w, y, x + w, y + h, false);
  side(x + w, y + h, x, y + h, false);
  side(x, y + h, x, y, false);
  path.closePath();
  return path;
}

/** «'26 11 19» из «2026-11-19» */
export const dateStamp = (date: string) => {
  const [y, m, d] = date.split('-');
  return `'${y.slice(2)} ${m} ${d}`;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Оранжевый DSEG7-штамп даты в правом нижнем углу кадра (right/bottom — край кадра). */
function drawDateStamp(ctx: CanvasRenderingContext2D, date: string, right: number, bottom: number, size: number, alpha: number) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.92;
  ctx.font = `${size}px DSEG7, "JetBrains Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.stamp;
  ctx.shadowColor = 'rgba(255,120,20,0.85)';
  ctx.shadowBlur = size * 0.5;
  // В DSEG7 пробел узкий — группы «'26», «11», «19» ставим сами, с промежутком почти в цифру
  const gap = ctx.measureText('8').width * 0.6;
  let x = right - size * 0.9;
  const y = bottom - size * 0.8;
  for (const part of dateStamp(date).split(' ').reverse()) {
    ctx.fillText(part, x, y);
    x -= ctx.measureText(part).width + gap;
  }
  ctx.restore();
}

/** Рукописная подпись по центру (Caveat), с ужатием, если не влезает. */
function drawCaption(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, maxW: number) {
  ctx.font = `${size}px Caveat, cursive`;
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = `${(size * maxW) / w}px Caveat, cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(cx, cy);
  ctx.rotate(-0.012);
  ctx.fillText(text, 0, 0);
}

export type PrintOverlay = {
  caption: string;
  date: string;
  develop: number;
  /** 0..1 — красный фонарь (гаснет к концу проявки) */
  safelight: number;
  /** пометка на поле отпечатка (например, «ИИ-оживление») — попадает и в запись проявки */
  badge?: string;
};

export function drawPrint(ctx: CanvasRenderingContext2D, L: PrintLayout, gl: HTMLCanvasElement, o: PrintOverlay) {
  const path = deckledPath(L);

  // тень и бумага
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = L.printW * 0.05;
  ctx.shadowOffsetY = L.printW * 0.015;
  ctx.fillStyle = COLORS.paper;
  ctx.fill(path);
  ctx.restore();

  // снимок и тонкая кромка эмульсии по краю окна
  ctx.drawImage(gl, L.photoX, L.photoY, L.photoW, L.photoH);
  ctx.save();
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.18)';
  ctx.lineWidth = Math.max(1, L.printW * 0.0015);
  ctx.strokeRect(L.photoX, L.photoY, L.photoW, L.photoH);
  ctx.restore();

  // штамп даты — впечатан в плёнку, проявляется вместе со снимком
  drawDateStamp(ctx, o.date, L.photoX + L.photoW, L.photoY + L.photoH, L.photoW * 0.045, smooth(0.55, 1, o.develop));

  // рукописная подпись под снимком
  const capA = smooth(0.85, 1, o.develop);
  if (capA > 0 && o.caption) {
    const bottomTop = L.photoY + L.photoH;
    const bottomH = L.printY + L.printH - bottomTop;
    ctx.save();
    ctx.globalAlpha = capA;
    ctx.fillStyle = COLORS.ink;
    drawCaption(ctx, o.caption, L.printX + L.printW / 2, bottomTop + bottomH * 0.48, L.printW * 0.065, L.photoW * 0.95);
    ctx.restore();
  }

  // пометка — на верхнем поле, справа: заметна, но не спорит со снимком
  if (o.badge) {
    const size = Math.max(9, L.printW * 0.024);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = COLORS.ink;
    ctx.font = `${size}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`✦ ${o.badge}`, L.photoX + L.photoW, (L.printY + L.photoY) / 2);
    ctx.restore();
  }

  // красный фонарь ложится на всю бумагу
  if (o.safelight > 0.001) {
    ctx.save();
    ctx.clip(path);
    ctx.globalCompositeOperation = 'multiply';
    const a = o.safelight;
    ctx.fillStyle = `rgb(255, ${Math.round(255 - 185 * a)}, ${Math.round(255 - 205 * a)})`;
    ctx.fillRect(L.printX, L.printY, L.printW, L.printH);
    ctx.restore();
  }
}

let noiseTile: HTMLCanvasElement | null = null;
/** Мелкая фактура стола — один раз, детерминированно (без Math.random, чтобы кадры совпадали). */
function tableNoise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(128, 128);
  let s = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 96 + (s % 96);
    img.data[i] = v;
    img.data[i + 1] = v * 0.92;
    img.data[i + 2] = v * 0.85;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

/** Тёмный стол лаборатории под отпечатком: тёплое пятно лампы и мелкая фактура. */
export function drawTable(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#221d19');
  g.addColorStop(0.6, '#151210');
  g.addColorStop(1, COLORS.lab);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(tableNoise(), 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Миниатюра для контактного листа: тёмный стол + полностью проявленный отпечаток. */
// ---------- слайд-шоу: вертикальный кадр 9:16 ----------

export type SlideLayout = { x: number; y: number; w: number; h: number };

/** top — высота верхней панели над сценой: кадр 9:16 встаёт ниже неё, чтобы полоски и название не прятались. */
export function computeSlideLayout(W: number, H: number, pad = 0.035, top = 0): SlideLayout {
  const availH = H - top;
  const w = Math.min(W * (1 - 2 * pad), availH * (1 - 2 * pad) * (9 / 16));
  const h = (w * 16) / 9;
  return { x: (W - w) / 2, y: top + (availH - h) / 2, w, h };
}

export type SlideOverlay = {
  caption: string;
  date: string;
  /** название папки дня */
  title: string;
  develop: number;
  safelight: number;
  /** какой кадр из скольких и насколько он прошёл — полоски, как в сторис */
  slide: number;
  slides: number;
  seg: number;
  badge?: string;
};

/**
 * Кадр слайд-шоу: те же постоянные элементы, что у отпечатка, — DSEG7-дата в углу кадра, Caveat-подпись,
 * название папки, красный фонарь на проявке; сверху полоски кадров.
 */
export function drawSlideFrame(ctx: CanvasRenderingContext2D, L: SlideLayout, win: HTMLCanvasElement, o: SlideOverlay) {
  const { x, y, w, h } = L;
  const frame = new Path2D();
  frame.roundRect(x, y, w, h, w * 0.03);

  // вокруг кадра холст прозрачный — сквозь него видно сияние дня на сцене
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = w * 0.08;
  ctx.fillStyle = '#000';
  ctx.fill(frame);
  ctx.restore();

  ctx.save();
  ctx.clip(frame);
  ctx.drawImage(win, x, y, w, h);

  // затемнение сверху и снизу — чтобы читались полоски, название и подпись
  const top = ctx.createLinearGradient(0, y, 0, y + h * 0.2);
  top.addColorStop(0, 'rgba(0,0,0,0.45)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, h * 0.2);
  const capA = smooth(0.85, 1, o.develop);
  const bottom = ctx.createLinearGradient(0, y + h * 0.66, 0, y + h);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, `rgba(0,0,0,${0.55 * capA})`);
  ctx.fillStyle = bottom;
  ctx.fillRect(x, y + h * 0.66, w, h * 0.34);

  // полоски кадров
  const pad = w * 0.05;
  const gap = Math.max(2, w * 0.012);
  const barH = Math.max(2, w * 0.007);
  const segW = (w - 2 * pad - gap * (o.slides - 1)) / o.slides;
  for (let i = 0; i < o.slides; i++) {
    const sx = x + pad + i * (segW + gap);
    const sy = y + pad * 0.7;
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillRect(sx, sy, segW, barH);
    const fill = i < o.slide ? 1 : i === o.slide ? Math.min(1, Math.max(0, o.seg)) : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(sx, sy, segW * fill, barH);
  }

  // название папки и пометка
  const small = Math.max(9, w * 0.032);
  ctx.font = `${small}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'left';
  ctx.fillText(o.title, x + pad, y + pad * 0.7 + barH + small * 0.8, w - 2 * pad);
  if (o.badge) {
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.85;
    ctx.fillText(`✦ ${o.badge}`, x + w - pad, y + pad * 0.7 + barH + small * 2.2);
    ctx.globalAlpha = 1;
  }

  // заставка: пока кадр проявляется, на бумаге — название дня
  const titleA = 1 - smooth(0.45, 0.85, o.develop);
  if (titleA > 0.01) {
    ctx.save();
    ctx.globalAlpha = titleA;
    ctx.fillStyle = COLORS.ink;
    drawCaption(ctx, o.title, x + w / 2, y + h * 0.46, w * 0.1, w * 0.84);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = titleA * 0.8;
    ctx.fillStyle = COLORS.ink;
    ctx.font = `${small}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dateStamp(o.date).replace(/ /g, ' · '), x + w / 2, y + h * 0.54);
    ctx.restore();
  }

  drawDateStamp(ctx, o.date, x + w - pad * 0.4, y + h - pad * 0.2, w * 0.05, smooth(0.55, 1, o.develop));

  if (capA > 0 && o.caption) {
    ctx.save();
    ctx.globalAlpha = capA;
    ctx.fillStyle = '#fffaf0';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = w * 0.02;
    drawCaption(ctx, o.caption, x + w / 2, y + h * 0.86, w * 0.085, w * 0.86);
    ctx.restore();
  }

  // красный фонарь — пока первый кадр проявляется
  if (o.safelight > 0.001) {
    ctx.globalCompositeOperation = 'multiply';
    const a = o.safelight;
    ctx.fillStyle = `rgb(255, ${Math.round(255 - 185 * a)}, ${Math.round(255 - 205 * a)})`;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

export function renderThumb(gl: HTMLCanvasElement, caption: string, date: string): Promise<Blob> {
  const W = 480;
  const H = 620;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  drawTable(ctx, W, H);
  drawPrint(ctx, computeLayout(W, H, 0.04), gl, { caption, date, develop: 1, safelight: 0 });
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Миниатюра не получилась'))), 'image/jpeg', 0.86),
  );
}
