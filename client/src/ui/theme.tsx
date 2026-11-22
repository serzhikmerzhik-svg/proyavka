/**
 * Палитры интерфейса. Меняют только оформление вокруг отпечатка: сам отпечаток (бумага, рамка, штамп,
 * подпись) одинаков у всех дней — единая визуальная система дневника (SPEC §1.6).
 * Выбор хранится в браузере (удобство одного зрителя); без хранилища — палитра по умолчанию.
 */
import { useState, type CSSProperties } from 'react';

export const THEMES = [
  { id: 'darkroom', name: 'Тёмная комната', bg: '#0f0d0c', accent: '#b3261e', light: false },
  { id: 'cyanotype', name: 'Цианотипия', bg: '#071a2c', accent: '#3d8fd6', light: false },
  { id: 'platinum', name: 'Платина', bg: '#1b1917', accent: '#c9a46c', light: false },
  { id: 'neon', name: 'Ночная плёнка', bg: '#0b0b12', accent: '#7c5cff', light: false },
  { id: 'ai', name: 'Нейросеть', bg: '#07070d', accent: '#22d3ee', light: false },
  { id: 'polaroid', name: 'Моментальное фото', bg: '#f4f1ea', accent: '#e2573b', light: true },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'proyavka:theme';
// новые зрители видят «Нейросеть»; выбранная палитра запоминается
const DEFAULT: ThemeId = 'ai';
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

export function applyTheme(id: ThemeId) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
  try {
    localStorage.setItem(KEY, theme.id);
  } catch {
    // хранилище недоступно (приватный режим) — палитра просто не запомнится
  }
}

/** Вызвать до первого рендера, чтобы не мигала палитра по умолчанию. */
export function initTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  applyTheme(isTheme(saved) ? saved : DEFAULT);
}

export function ThemePicker() {
  const [current, setCurrent] = useState<ThemeId>(() => {
    const v = document.documentElement.dataset.theme;
    return isTheme(v) ? v : DEFAULT;
  });
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Палитра интерфейса">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={current === t.id}
          aria-label={t.name}
          title={t.name}
          className={`swatch${t.id === 'ai' ? ' swatch-ai' : ''}`}
          style={{ '--sw-bg': t.bg, '--sw-accent': t.accent } as CSSProperties}
          onClick={(e) => {
            e.stopPropagation();
            applyTheme(t.id);
            setCurrent(t.id);
          }}
        />
      ))}
    </div>
  );
}
