/**
 * Запись проявки в webm (SPEC §6: «финальный кадр собирается на 2D-canvas, так экспорт через
 * MediaRecorder захватывает всё»): кадр с экрана кладётся на стол лаборатории, звук — музыка и голос.
 */
import { drawTable } from './compositor';

const MIME = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export class DevelopRecorder {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  readonly done: Promise<Blob>;

  static supported() {
    return typeof MediaRecorder !== 'undefined' && MIME.some((m) => MediaRecorder.isTypeSupported(m));
  }

  /** width/height — размер видео (чётные), audio — дорожка из графа Web Audio. */
  constructor(width: number, height: number, audio?: MediaStreamTrack) {
    this.canvas.width = Math.round(width / 2) * 2;
    this.canvas.height = Math.round(height / 2) * 2;
    this.ctx = this.canvas.getContext('2d')!;
    drawTable(this.ctx, this.canvas.width, this.canvas.height);
    const stream = this.canvas.captureStream(30);
    if (audio) stream.addTrack(audio);
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.done = new Promise((resolve) => {
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: 'video/webm' }));
    });
    this.rec.start(1000);
  }

  get recording() {
    return this.rec.state === 'recording';
  }

  /** Кадр видео: стол + текущий отпечаток с экрана (вписан по центру); rect — только эта часть экрана. */
  draw(source: HTMLCanvasElement, rect?: { x: number; y: number; w: number; h: number }) {
    const { width: W, height: H } = this.canvas;
    if (rect) {
      // углы кадра на экране прозрачные — в видео под ними чёрный, а не прошлые кадры
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, W, H);
      this.ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, W, H);
      return;
    }
    drawTable(this.ctx, W, H);
    const s = Math.min(W / source.width, H / source.height);
    const w = source.width * s;
    const h = source.height * s;
    this.ctx.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
  }

  stop() {
    if (this.rec.state !== 'inactive') this.rec.stop();
  }
}
