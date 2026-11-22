/**
 * Композиции окна снимка (SPEC §5): single, diptych, sequence, strip, contact_sheet.
 * Раскладка — чистая функция в пикселях окна (ось y вниз); рисует её printScene.
 */
import type { Recipe } from '../recipe/types';

export type Kind = Recipe['composition'];
export type Rect = { x: number; y: number; w: number; h: number };
export type Slot = Rect & { photo: number; label: string };

export type WindowLayout = {
  kind: Kind;
  /** чем залит фон окна между ячейками */
  base: 'none' | 'paper' | 'film';
  slots: Slot[];
  /** отверстия перфорации (только плёнка) */
  sprockets: Rect[];
  /** ячейка, обведённая красным карандашом («кадр дня» на контактном листе) */
  circle: number | null;
};

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function windowLayout(kind: Kind, photoCount: number, best: number, W: number, H: number): WindowLayout {
  const n = Math.max(1, photoCount);
  const bestIdx = Math.min(Math.max(0, best), n - 1);

  if (kind === 'single' || kind === 'sequence' || n === 1) {
    return { kind, base: 'none', slots: [{ x: 0, y: 0, w: W, h: H, photo: bestIdx, label: '1' }], sprockets: [], circle: null };
  }

  if (kind === 'diptych') {
    // два кадра рядом, между ними полоска бумаги; «кадр дня» слева
    const gap = W * 0.025;
    const w = (W - gap) / 2;
    const other = range(n).find((i) => i !== bestIdx) ?? bestIdx;
    return {
      kind,
      base: 'paper',
      slots: [
        { x: 0, y: 0, w, h: H, photo: bestIdx, label: '1' },
        { x: w + gap, y: 0, w, h: H, photo: other, label: '2' },
      ],
      sprockets: [],
      circle: null,
    };
  }

  // плёнка: кадры по порядку съёмки, перфорация по краям
  const side = W * 0.09;
  const sprockets: Rect[] = [];
  const holeW = side * 0.42;
  const holeH = holeW * 1.35;
  const pitch = holeH * 2.1;
  for (let y = pitch * 0.4; y + holeH < H; y += pitch) {
    sprockets.push({ x: (side - holeW) / 2, y, w: holeW, h: holeH });
    sprockets.push({ x: W - side + (side - holeW) / 2, y, w: holeW, h: holeH });
  }

  if (kind === 'strip') {
    const count = Math.min(n, 4);
    const gap = H * 0.022;
    const h = (H - gap * (count + 1)) / count;
    const slots = range(count).map((i) => ({ x: side, y: gap + i * (h + gap), w: W - 2 * side, h, photo: i, label: String(i + 1) }));
    return { kind, base: 'film', slots, sprockets, circle: null };
  }

  // contact_sheet: сетка 2 × ⌈n/2⌉, «кадр дня» обведён красным
  const count = Math.min(n, 6);
  const cols = 2;
  const rows = Math.ceil(count / cols);
  const gap = W * 0.03;
  const w = (W - 2 * side - gap * (cols - 1)) / cols;
  const h = (H - gap * (rows + 1)) / rows;
  const slots = range(count).map((i) => ({
    x: side + (i % cols) * (w + gap),
    y: gap + Math.floor(i / cols) * (h + gap),
    w,
    h,
    photo: i,
    label: `${i + 1}A`,
  }));
  return { kind, base: 'film', slots, sprockets, circle: slots.findIndex((s) => s.photo === bestIdx) };
}

// ---------- отрисовка подложки и пометок ----------
const FILM = '#17120f';
const HOLE = '#3a322b';
const EDGE_TEXT = '#ff8a1f';
const PENCIL = '#b3261e';

export function drawBase(ctx: CanvasRenderingContext2D, L: WindowLayout, W: number, H: number, paper: string) {
  if (L.base === 'none') return;
  ctx.fillStyle = L.base === 'film' ? FILM : paper;
  ctx.fillRect(0, 0, W, H);
  if (L.base !== 'film') return;
  ctx.fillStyle = HOLE;
  for (const s of L.sprockets) {
    const r = s.w * 0.25;
    ctx.beginPath();
    ctx.roundRect(s.x, s.y, s.w, s.h, r);
    ctx.fill();
  }
}

/** Номера кадров на краю плёнки — как у настоящего контактного листа. */
export function drawFrameNumbers(ctx: CanvasRenderingContext2D, L: WindowLayout, W: number) {
  if (L.base !== 'film') return;
  const size = Math.max(8, W * 0.026);
  ctx.save();
  ctx.fillStyle = EDGE_TEXT;
  ctx.globalAlpha = 0.8;
  ctx.font = `${size}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';
  for (const s of L.slots) ctx.fillText(s.label, s.x + size * 0.3, s.y + s.h + size * 0.15);
  ctx.restore();
}

/** Красный «жирный карандаш»: неровный эллипс с заходом за начало, в два слоя. */
export function drawPencilCircle(ctx: CanvasRenderingContext2D, slot: Rect, W: number, alpha: number) {
  if (alpha <= 0) return;
  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;
  const rx = slot.w * 0.58;
  const ry = slot.h * 0.6;
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;
  ctx.strokeStyle = PENCIL;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = W * (pass === 0 ? 0.011 : 0.006);
    ctx.beginPath();
    const start = -0.4 + pass * 0.25;
    const end = start + Math.PI * 2 + 0.55; // заход за начало, как рукой
    for (let a = start; a <= end; a += 0.05) {
      const wobble = 1 + 0.035 * Math.sin(a * 3 + pass * 1.7) + 0.02 * Math.sin(a * 7 + 0.5);
      const x = cx + Math.cos(a) * rx * wobble;
      const y = cy + Math.sin(a) * ry * wobble * (1 - 0.04 * pass);
      if (a === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
