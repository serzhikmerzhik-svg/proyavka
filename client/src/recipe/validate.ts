/**
 * Клиентские проверки ответа анализа — SPEC §4.4.
 * Модель (или эвристика) предлагает, клиент решает: в рецепт попадает только то, что прошло проверку.
 */

const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
export const countWords = (s: string) => (s.match(WORD) ?? []).length;

const SENSORY = /(тепл|холод|запах|пах|вкус|свет|солн|дожд|снег|ветер|ветр|какао|чай|кофе|смея|тиш|шум|мягк|горяч|рук|глаз|небо|лист|мор|огн|звёзд|звезд|музык|песн)/iu;
const TRIM_EDGE = /^[\s«»"„“”'‘’([—–-]+|[\s«»"„“”'‘’)\].,;:!?…—–-]+$/gu;

const CLAUSE_END = /[,;:]$/u;
const DASH = /^[—–-]$/u;

/**
 * 3–6 слов подряд из самого «чувственного» предложения; всегда подстрока текста.
 * Окно не рвёт оборот (не переходит через запятую) и тяготеет к целой фразе из ~4 слов.
 * Та же функция — в server/src/heuristic.ts (держать в синхроне).
 */
export function pickCaption(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);
  let best = { score: -Infinity, quote: '' };
  for (const s of sentences) {
    const words = [...s.matchAll(/\S+/gu)];
    const n = words.length;
    if (n === 0) continue;
    const minLen = Math.min(3, n);
    for (let len = Math.min(6, n); len >= minLen; len--) {
      for (let i = 0; i + len <= n; i++) {
        const span = words.slice(i, i + len);
        const last = span[len - 1];
        const quote = s.slice(span[0].index!, last.index! + last[0].length).replace(TRIM_EDGE, '');
        if (quote.split(/\s+/u).length < minLen) continue;
        const hits = span.filter((w) => SENSORY.test(w[0])).length;
        const crossings = span.slice(0, -1).filter((w) => CLAUSE_END.test(w[0]) || DASH.test(w[0])).length;
        const startsClause = i === 0 || CLAUSE_END.test(words[i - 1][0]) || DASH.test(words[i - 1][0]);
        const endsClause = i + len === n || /[,;:.!?…]$/u.test(last[0]);
        const score =
          hits * 10 - crossings * 6 + (startsClause ? 1.5 : 0) + (endsClause ? 1.5 : 0) - Math.abs(len - 4) * 0.5;
        if (score > best.score) best = { score, quote };
      }
    }
  }
  return best.quote || text.trim().split(/\s+/u).slice(0, 5).join(' ').replace(TRIM_EDGE, '');
}

/**
 * Нормализация «без учёта регистра и лишних пробелов» (плюс ё = е) с картой индексов,
 * чтобы по найденному месту вернуть кусок исходного текста — дословно, как писал человек.
 */
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/u.test(ch)) {
      pendingSpace = norm.length > 0;
      continue;
    }
    if (pendingSpace) {
      norm += ' ';
      map.push(i);
      pendingSpace = false;
    }
    const low = ch.toLowerCase().replace('ё', 'е');
    for (let k = 0; k < low.length; k++) map.push(i);
    norm += low;
  }
  return { norm, map };
}

export type CaptionCheck = { caption: string; replaced: boolean; reason?: string };

/** captionQuote: 2–6 слов, подстрока текста без учёта регистра и лишних пробелов. */
export function checkCaption(quote: string, text: string): CaptionCheck {
  const q = quote.replace(TRIM_EDGE, '').trim();
  const words = countWords(q);
  let reason: string;
  if (!q) reason = 'цитата пустая';
  else if (words < 2 || words > 6) reason = `в цитате ${words} слов, нужно 2–6`;
  else {
    const t = normalizeWithMap(text);
    const needle = normalizeWithMap(q).norm;
    const at = t.norm.indexOf(needle);
    if (at >= 0) {
      const start = t.map[at];
      const end = t.map[at + needle.length - 1] + 1;
      return { caption: text.slice(start, end).replace(/\s+/gu, ' '), replaced: false };
    }
    reason = 'такой фразы нет в тексте дословно';
  }
  return { caption: pickCaption(text), replaced: true, reason };
}

// ---------- название папки ----------
const BANNED = /(?<!\p{L})(?:не|наи)?(счастлив|грустн|лучш)\p{L}*/iu;
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const PATH_CHARS = /[\\/:*?"<>|]/u;
const WRAP_QUOTES = /^[«„“'‘]+|[»”'’]+$/gu;

export const cleanFolderName = (raw: string) => raw.replace(/\s+/gu, ' ').trim().replace(WRAP_QUOTES, '').trim();

/** Причина, по которой название не годится, или null. */
export function folderNameIssue(name: string): string | null {
  if (!name) return 'пустое';
  const words = countWords(name);
  if (words < 3 || words > 7) return `${words} слов, нужно 3–7`;
  const banned = BANNED.exec(name);
  if (banned) return `эмоция в лоб: «${banned[0]}»`;
  if (EMOJI.test(name)) return 'эмодзи';
  if (/\.\s*$/u.test(name)) return 'точка в конце';
  if (PATH_CHARS.test(name)) return 'символ, недопустимый в имени папки';
  if (name.length > 60) return 'длиннее 60 символов';
  return null;
}

export const isValidFolderName = (name: string) => folderNameIssue(cleanFolderName(name)) === null;

export type FolderCheck = {
  name: string;
  /** номер принятого варианта; −1 — все отклонены, взято запасное */
  chosenIndex: number;
  rejected: { name: string; reason: string }[];
};

/** Первый валидный вариант; если валидных нет — нейтральное запасное название с датой. */
export function checkFolderNames(candidates: string[], date: string): FolderCheck {
  const rejected: FolderCheck['rejected'] = [];
  for (const [i, raw] of candidates.entries()) {
    const name = cleanFolderName(raw);
    const issue = folderNameIssue(name);
    if (!issue) return { name, chosenIndex: i, rejected };
    rejected.push({ name, reason: issue });
  }
  const [, m, d] = date.split('-');
  return { name: `Страница дня ${d}.${m}`, chosenIndex: -1, rejected };
}
