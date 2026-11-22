/**
 * «Рецепт» человеческим языком: 3–5 причин, почему отпечаток выглядит именно так (SPEC §5).
 * Всегда: ритм и процесс. Дальше по важности: противоречие, свет, особенность дня, композиция, лад.
 */
import { PROCESS_NAMES } from './presets';
import type { Recipe, TextAnalysis } from './types';

const HOLD: Record<number, string> = { 1: 'такт', 0.5: 'полтакта', 0.25: 'четверть такта' };

const LIGHT: Partial<Record<Recipe['light']['time'], string>> = {
  golden_hour: 'Золотой час: тёплый низкий свет',
  evening: 'Вечер: тёплый низкий свет',
  night: 'Ночь: низкий ключ и ореолы',
  morning: 'Утро: мягкие приподнятые тени',
};

const energyWord = (e: number) => (e < 0.4 ? 'тихо' : e < 0.7 ? 'размеренно' : 'интенсивно');
const toneWord = (t: number) => (t < 0.4 ? 'тяжело' : t < 0.6 ? 'ровно' : 'светло');

function whoWord(together: number, text: string): string {
  if (together > 0.6) return /вдво[её]м/iu.test(text) ? 'Вдвоём' : 'Вместе';
  if (together < 0.35) return 'Наедине';
  return 'В своём ритме';
}

export function buildWhy(r: Omit<Recipe, 'why'>, a: TextAnalysis, text = '', photoCount = 1): string[] {
  const { energy, tone, together, special } = r.atmosphere;

  const rhythm =
    `${Math.round(r.music.bpm)} BPM: кадр держится ${HOLD[r.rhythm.frameHoldBars] ?? `${r.rhythm.frameHoldBars} такта`}, ` +
    (r.rhythm.transition === 'cut' ? 'склейки на долях' : 'мягкие наплывы');

  const [main, second] = r.process;
  const process =
    `${whoWord(together, text)}, ${energyWord(energy)} и ${toneWord(tone)}: ${PROCESS_NAMES[main.id]}` +
    (second && second.weight >= 0.3 ? ` с долей «${PROCESS_NAMES[second.id]}» ${Math.round(second.weight * 100)}%` : '');

  const optional: (string | null)[] = [
    a.contrast.has && a.contrast.cold && a.contrast.warm
      ? `«${a.contrast.cold}, но ${a.contrast.warm}»: холодные тени, тёплые света`
      : null,
    LIGHT[r.light.time] ?? null,
    special > 0.6 ? 'Особенный день: гуще зерно, сильнее ореолы и выцветание' : null,
    r.composition === 'diptych'
      ? 'Два кадра и близость: диптих'
      : r.composition === 'strip'
        ? `${photoCount} кадра в быстром темпе: плёночная полоса`
        : r.composition === 'contact_sheet'
          ? `${photoCount} кадров: контактный лист, кадр дня обведён красным`
          : null,
    (() => {
      const major = r.music.mode === 'major';
      const light = tone >= 0.5;
      const mood =
        major === light
          ? `${major ? 'Мажор' : 'Минор'}: тон ${light ? 'светлее' : 'тяжелее'}`
          : `${major ? 'Мажор' : 'Минор'}, но слова дня ${light ? 'светлые' : 'тяжёлые'}`;
      return `${mood}, проявка за ${r.rhythm.developBars} такта`;
    })(),
  ];

  return [rhythm, process, ...optional.filter((l): l is string => Boolean(l))].slice(0, 5);
}
