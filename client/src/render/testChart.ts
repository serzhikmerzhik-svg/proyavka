/**
 * Процедурная тестовая таблица для /lab (рисуется кодом, не нейросетью): сцена со светом и краями,
 * 24 поля ColorChecker, плавная серая шкала, радуга оттенков и 11 ступеней серого.
 */
import { loadImage } from './renderer';

// приблизительные sRGB-цвета классической таблицы ColorChecker
const CHECKER = [
  '#735244', '#c29682', '#627a9d', '#576c43', '#8580b1', '#67bdaa',
  '#d67e2c', '#505ba6', '#c15a63', '#5e3c6c', '#9dbc40', '#e0a32e',
  '#383d96', '#469449', '#af363c', '#e7c71f', '#bb5695', '#0885a1',
  '#f3f3f2', '#c8c8c8', '#a0a0a0', '#7a7a79', '#555555', '#343434',
];

export async function makeTestChart(): Promise<HTMLImageElement> {
  const W = 1200;
  const H = 1500;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#2a2622';
  x.fillRect(0, 0, W, H);

  // сцена: небо, солнце (ореолы, Сабатье), тёмные силуэты (плотные тени, линии Маки)
  const sky = x.createLinearGradient(0, 0, 0, 620);
  sky.addColorStop(0, '#5f86b8');
  sky.addColorStop(0.7, '#f0a861');
  sky.addColorStop(1, '#c4683c');
  x.fillStyle = sky;
  x.fillRect(0, 0, W, 620);
  const sun = x.createRadialGradient(860, 230, 0, 860, 230, 150);
  sun.addColorStop(0, '#ffffff');
  sun.addColorStop(0.5, '#fff4d6');
  sun.addColorStop(1, 'rgba(255, 220, 160, 0)');
  x.fillStyle = sun;
  x.fillRect(700, 70, 320, 320);
  x.fillStyle = '#1b1917';
  x.beginPath();
  x.moveTo(0, 620);
  x.bezierCurveTo(200, 430, 380, 520, 560, 470);
  x.bezierCurveTo(760, 410, 980, 520, 1200, 450);
  x.lineTo(1200, 620);
  x.closePath();
  x.fill();
  x.fillRect(210, 300, 26, 260);
  x.fillRect(300, 340, 18, 220);

  // ColorChecker 6 × 4
  const m = 30;
  const gap = 14;
  const pw = (W - 2 * m - 5 * gap) / 6;
  const ph = (440 - 3 * gap) / 4;
  CHECKER.forEach((col, i) => {
    x.fillStyle = col;
    x.fillRect(m + (i % 6) * (pw + gap), 640 + Math.floor(i / 6) * (ph + gap), pw, ph);
  });

  // плавная серая шкала
  const ramp = x.createLinearGradient(m, 0, W - m, 0);
  ramp.addColorStop(0, '#000000');
  ramp.addColorStop(1, '#ffffff');
  x.fillStyle = ramp;
  x.fillRect(m, 1100, W - 2 * m, 120);

  // оттенки
  const hue = x.createLinearGradient(m, 0, W - m, 0);
  for (let i = 0; i <= 12; i++) hue.addColorStop(i / 12, `hsl(${i * 30}, 80%, 55%)`);
  x.fillStyle = hue;
  x.fillRect(m, 1235, W - 2 * m, 120);

  // 11 ступеней серого
  const sw = (W - 2 * m) / 11;
  for (let i = 0; i < 11; i++) {
    const v = Math.round((i / 10) * 255);
    x.fillStyle = `rgb(${v}, ${v}, ${v})`;
    x.fillRect(m + i * sw, 1370, Math.ceil(sw), 100);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Таблица не получилась'))), 'image/png'),
  );
  return loadImage(blob);
}
