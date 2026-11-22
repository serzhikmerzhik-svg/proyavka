/**
 * Сцена отпечатка: композиция кадров дня → окно снимка (2D-canvas), которое компоновщик
 * кладёт в рамку. Каждая ячейка проходит через тот же шейдер со своим кадром и картой глубины.
 */
import { PrintRenderer, loadImage, type PhotoSource } from './renderer';
import { loadVideo, unloadVideo, type LoadedVideo } from './video';
import { resolveParams } from './params';
import { drawBase, drawFrameNumbers, drawPencilCircle, windowLayout, type WindowLayout } from './composition';
import { COLORS, computeLayout, drawPrint, drawTable, ensureFonts } from './compositor';
import type { Day, Recipe } from '../recipe/types';

export type SceneFrame = {
  /** секунды с начала проявки (часы звука или таймер) */
  t: number;
  /** время для медленных эффектов шейдера */
  time: number;
  develop: number;
  beat: number;
  seed: number;
  rms: number;
  parallax: [number, number];
  airTime: number;
  reduced: boolean;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class PrintScene {
  readonly window: HTMLCanvasElement = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private renderer = new PrintRenderer(256, 320);
  private W = 1;
  private H = 1;

  static async create(day: Day, recipe: Recipe): Promise<PrintScene> {
    const imgs = await Promise.all(day.photos.map((p) => loadImage(p.blob)));
    const depths = await Promise.all(day.photos.map((p) => (p.depth ? loadImage(p.depth) : Promise.resolve(null))));
    return new PrintScene(imgs, depths, recipe);
  }

  private constructor(
    private imgs: HTMLImageElement[],
    private depths: (HTMLImageElement | null)[],
    private recipe: Recipe,
  ) {
    this.ctx = this.window.getContext('2d')!;
    this.setRecipe(recipe);
  }

  setRecipe(recipe: Recipe) {
    this.recipe = recipe;
    this.renderer.setParams(resolveParams(recipe));
  }

  async setDepth(index: number, blob: Blob) {
    this.depths[index] = await loadImage(blob);
  }

  private motion: (LoadedVideo & { index: number }) | null = null;
  private motionLive = false;

  /** ИИ-оживление: после проявки видео подменяет свой кадр (null — убрать). */
  async setMotion(blob: Blob | null, index = 0): Promise<void> {
    this.clearMotion();
    if (!blob) return;
    this.motion = { ...(await loadVideo(blob)), index };
  }

  /** Видно ли сейчас ИИ-оживление — тогда на отпечатке нужна пометка. */
  get motionShown(): boolean {
    return this.motionLive;
  }

  private clearMotion() {
    const m = this.motion;
    if (!m) return;
    this.motion = null;
    this.motionLive = false;
    this.renderer.forget(m.video);
    unloadVideo(m);
  }

  get depthCount() {
    return this.depths.filter(Boolean).length;
  }

  resize(width: number, height: number) {
    this.W = Math.max(1, Math.round(width));
    this.H = Math.max(1, Math.round(height));
    this.window.width = this.W;
    this.window.height = this.H;
  }

  /** Раскладка на момент t: контактный лист держится до конца проявки и ещё два такта, затем — sequence. */
  layoutAt(t: number): { layout: WindowLayout; seqStart: number } {
    const r = this.recipe;
    const bar = r.music.barSeconds;
    let kind = r.composition;
    let seqStart = r.rhythm.developBars * bar;
    if (kind === 'contact_sheet') {
      seqStart += 2 * bar;
      if (t >= seqStart) kind = 'sequence';
    }
    return { layout: windowLayout(kind, this.imgs.length, r.bestPhotoIndex, this.W, this.H), seqStart };
  }

  draw(f: SceneFrame): HTMLCanvasElement {
    const r = this.recipe;
    const n = this.imgs.length;
    const ctx = this.ctx;
    const { layout, seqStart } = this.layoutAt(f.t);
    const best = Math.min(r.bestPhotoIndex, n - 1);
    const order = [best, ...this.imgs.map((_, i) => i).filter((i) => i !== best)];

    // ИИ-оживление включается, когда снимок проявился, и всегда с начала петли; при «меньше движения» — нет
    const m = this.motion && f.develop >= 1 && !f.reduced ? this.motion : null;
    if (m && !this.motionLive) {
      this.motionLive = true;
      m.video.currentTime = 0;
      void m.video.play().catch(() => undefined);
    } else if (!m && this.motionLive) {
      this.motionLive = false;
      this.motion?.video.pause();
    }
    const live = m && m.video.readyState >= 2 ? m : null;
    const src = (i: number): PhotoSource => (live && i === live.index ? live.video : this.imgs[i]);

    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, this.W, this.H);
    // плёночная подложка тоже «проявляется»: бумага сначала белая
    ctx.save();
    ctx.globalAlpha = layout.base === 'film' ? smooth(0.05, 0.7, f.develop) : 1;
    drawBase(ctx, layout, this.W, this.H, COLORS.paper);
    ctx.restore();

    layout.slots.forEach((slot, i) => {
      let a = slot.photo;
      let b = slot.photo;
      let mix = 0;
      if (layout.kind === 'sequence' && n > 1 && f.develop >= 1 && !f.reduced) {
        const hold = r.rhythm.frameHoldBars * r.music.barSeconds;
        const lt = Math.max(0, f.t - seqStart) / hold;
        const k = Math.floor(lt);
        a = order[k % n];
        b = order[(k + 1) % n];
        mix = r.rhythm.transition === 'dissolve' ? smooth(0.55, 1, lt - k) : 0;
      }
      // второй кадр двойной экспозиции — следующий по порядку (если кадр один, шейдер отражает его же)
      const partner = order[(order.indexOf(a) + 1) % n];
      let photoB = src(b);
      if (live && a === live.index && b === a) {
        // конец петли растворяется в неподвижный кадр, а с него же видео и начинается — шва не видно
        const d = live.video.duration;
        if (Number.isFinite(d) && d > 1.5) {
          photoB = this.imgs[a];
          mix = smooth(d - 0.8, d - 0.05, live.video.currentTime);
        }
      }
      this.renderer.resize(slot.w, slot.h);
      this.renderer.setFrameAspect(slot.w / slot.h);
      this.renderer.setPhotos(src(a), photoB, src(partner));
      this.renderer.setDepth(this.depths[a] ?? null);
      this.renderer.render({
        time: f.time, develop: f.develop, beat: f.beat, rms: f.rms, seed: f.seed, mix,
        parallax: f.parallax, airTime: f.airTime, frameSeed: i,
      });
      ctx.drawImage(this.renderer.canvas, slot.x, slot.y, slot.w, slot.h);
    });

    ctx.save();
    ctx.globalAlpha = smooth(0.4, 0.9, f.develop);
    drawFrameNumbers(ctx, layout, this.W);
    ctx.restore();
    if (layout.circle !== null && layout.circle >= 0) {
      drawPencilCircle(ctx, layout.slots[layout.circle], this.W, smooth(0.92, 1, f.develop));
    }
    return this.window;
  }

  dispose() {
    this.clearMotion();
    this.renderer.dispose();
  }
}

/** print.png для папки дня: полностью проявленный отпечаток на столе, ~1200 px по ширине. */
export async function exportPrintPng(day: Day, recipe: Recipe): Promise<Blob> {
  await ensureFonts();
  const scene = await PrintScene.create(day, recipe);
  try {
    const c = document.createElement('canvas');
    c.width = 1300;
    c.height = 1760;
    const ctx = c.getContext('2d')!;
    drawTable(ctx, c.width, c.height);
    const L = computeLayout(c.width, c.height, 0.04);
    scene.resize(L.photoW, L.photoH);
    const t = recipe.rhythm.developBars * recipe.music.barSeconds; // момент «проявлено»: у контактного листа — сам лист
    const win = scene.draw({ t, time: 0, develop: 1, beat: 0, seed: 0, rms: 0.5, parallax: [0, 0], airTime: 0, reduced: true });
    drawPrint(ctx, L, win, { caption: recipe.caption, date: day.date, develop: 1, safelight: 0 });
    return await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('print.png не получился'))), 'image/png'),
    );
  } finally {
    scene.dispose();
  }
}
