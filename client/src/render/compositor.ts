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
  const stampA = smooth(0.55, 1, o.develop);
  if (stampA > 0) {
    const size = L.photoW * 0.045;
    ctx.save();
    ctx.globalAlpha = stampA * 0.92;
    ctx.font = `${size}px DSEG7, "JetBrains Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.stamp;
    ctx.shadowColor = 'rgba(255,120,20,0.85)';
    ctx.shadowBlur = size * 0.5;
    // В DSEG7 пробел узкий — группы «'26», «11», «19» ставим сами, с промежутком почти в цифру
    const gap = ctx.measureText('8').width * 0.6;
    let x = L.photoX + L.photoW - size * 0.9;
    const y = L.photoY + L.photoH - size * 0.8;
    for (const part of dateStamp(o.date).split(' ').reverse()) {
      ctx.fillText(part, x, y);
      x -= ctx.measureText(part).width + gap;
    }
    ctx.restore();
  }

  // рукописная подпись под снимком
  const capA = smooth(0.85, 1, o.develop);
  if (capA > 0 && o.caption) {
    const bottomTop = L.photoY + L.photoH;
    const bottomH = L.printY + L.printH - bottomTop;
    let size = L.printW * 0.065;
    ctx.save();
    ctx.globalAlpha = capA;
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${size}px Caveat, cursive`;
    const maxW = L.photoW * 0.95;
    const w = ctx.measureText(o.caption).width;
    if (w > maxW) {
      size *= maxW / w;
      ctx.font = `${size}px Caveat, cursive`;
    }
    ctx.translate(L.printX + L.printW / 2, bottomTop + bottomH * 0.48);
    ctx.rotate(-0.012);
    ctx.fillText(o.caption, 0, 0);
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
