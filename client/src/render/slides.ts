/**
 * Слайд-шоу — второй способ проявить тот же день: формат «короткое видео с музыкой», 9:16.
 * Постоянное у обоих режимов: процесс и палитра рецепта (тот же шейдер), зерно и фонарь на долях,
 * Caveat-подпись, DSEG7-дата, название папки. Переменное — из рецепта: длина кадра от темпа
 * и энергии дня, наплыв или склейка, сила наезда камеры. Первый кадр проявляется, как на плёнке.
 */
import type { Recipe } from '../recipe/types';

export const SLIDE_ASPECT = 9 / 16;

export type SlideTimeline = {
  /** проявка первого кадра, с */
  intro: number;
  /** сколько держится кадр, с */
  hold: number;
  /** наплыв в следующий кадр, с (0 — склейка) */
  fade: number;
};

/**
 * Кадр держится 2–4 такта: чем выше энергия дня, тем короче (быстрая песня и так даёт короткий такт).
 * Наплыв — две доли; если рецепт велит резать (резкий день), кадры склеиваются встык.
 */
export function slideTimeline(r: Pick<Recipe, 'music' | 'atmosphere' | 'rhythm'>): SlideTimeline {
  const bar = r.music.barSeconds;
  const beat = 60 / r.music.bpm;
  const e = r.atmosphere.energy;
  const bars = e > 0.66 ? 2 : e > 0.4 ? 3 : 4;
  const hold = Math.min(9, Math.max(2.5, bars * bar));
  const fade = r.rhythm.transition === 'cut' ? 0 : Math.min(hold * 0.4, 2 * beat);
  const intro = Math.min(6, Math.max(2, 2 * bar));
  return { intro, hold, fade };
}

/** Начало и конец k-го кадра: первый кадр ещё и проявляется, поэтому длиннее. */
export const slideStart = (k: number, tl: SlideTimeline) => (k === 0 ? 0 : tl.intro + k * tl.hold);
export const slideEnd = (k: number, tl: SlideTimeline) => tl.intro + (k + 1) * tl.hold;

export type SlideState = {
  /** номер кадра с начала (без зацикливания) */
  k: number;
  /** 0..1 — сколько кадр уже на экране (для наезда камеры) */
  p: number;
  /** 0..1 — то же для следующего кадра (он появляется во время наплыва) */
  next: number;
  /** 0..1 — непрозрачность следующего кадра */
  fade: number;
  /** 0..1 — заполнение полоски кадра (как в сторис) */
  seg: number;
};

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function slideAt(t: number, tl: SlideTimeline): SlideState {
  const k = t < tl.intro + tl.hold ? 0 : Math.floor((t - tl.intro) / tl.hold);
  const end = slideEnd(k, tl);
  // кадр виден с начала наплыва в него и до своего конца
  const visible = (j: number) => {
    const s = j === 0 ? 0 : slideStart(j, tl) - tl.fade;
    return Math.min(1, Math.max(0, (t - s) / (slideEnd(j, tl) - s)));
  };
  const fade = tl.fade > 0 ? smooth((t - (end - tl.fade)) / tl.fade) : 0;
  return { k, p: visible(k), next: visible(k + 1), fade, seg: (t - slideStart(k, tl)) / (end - slideStart(k, tl)) };
}

/** Длина ролика: полный круг кадров, но не короче 15 и не длиннее 60 секунд. */
export const slideshowSeconds = (photoCount: number, tl: SlideTimeline) =>
  Math.min(60, Math.max(15, tl.intro + photoCount * tl.hold + 0.5));
