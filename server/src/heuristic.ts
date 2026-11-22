/**
 * Эвристический анализ текста дня по ключевым словам — запасной вариант и демо-режим без ключей API.
 * Детерминирован: одинаковый ввод → одинаковый результат.
 */
import type { AnalyzeRequest, ProcessId, TextAnalysis } from './types.js';

const clamp = (v: number, lo = 0.05, hi = 0.95) => Math.min(hi, Math.max(lo, v));

type Lex = RegExp[];
const rx = (...stems: string[]): Lex => stems.map((s) => new RegExp(s, 'giu'));

const LEX = {
  energyUp: rx('бег', 'бежал', 'танц', 'концерт', 'спеш', 'быстр', 'громк', 'вечеринк', 'драйв', 'прыга', 'гонк',
    'дедлайн', 'сдач', 'сует', 'толп', 'шумн', 'энерги', 'кричал', 'аврал', 'фестивал'),
  energyDown: rx('тих', 'спокойн', 'медленн', 'лениво', 'дремал', 'спал', 'плед', 'читал', 'молча', 'уют',
    'неспешн', 'отдыхал', 'тишин', 'лежал', 'сидели', 'смотрели'),
  toneUp: rx('смеял', 'смех', 'радост', 'тепл', 'солнц', 'вкусн', 'обня', 'улыб', 'светл', 'легко',
    'красив', 'нежн', 'весел', 'любим', 'спасиб', 'хорош', 'какао', 'счаст'),
  toneDown: rx('устал', 'тяжел', 'тяжёл', 'груст', 'плакал', 'одинок', 'болел', 'болит', 'тревож', 'страшн',
    'потерял', 'скучал', 'злил', 'ссор', 'провал', 'слёз', 'слез', 'пусто', 'тоск'),
  together: rx('(^|\\s)мы(\\s|$)', 'вместе', 'друз', 'мам', 'пап', 'бабушк', 'дедушк', 'сестр', 'брат', 'семь',
    'подруг', 'коллег', 'гост', 'компани', 'вдвоём', 'вдвоем', 'с ним', 'с ней', 'нами'),
  alone: rx('(^|\\s)один(\\s|$)', '(^|\\s)одна(\\s|$)', 'наедине', 'в одиночк', 'никого'),
  special: rx('впервые', 'перв(ый|ая|ое|ые)', 'наконец', 'день рождения', 'свадьб', 'праздник', 'выпускн',
    'переезд', 'путешеств', 'никогда', 'особенн', 'запомн', 'годовщин', 'новый год', 'новогодн', 'премьер'),
};

const count = (text: string, lex: Lex) => lex.reduce((n, r) => n + (text.match(r)?.length ?? 0), 0);

const TIME_RULES: [RegExp, TextAnalysis['timeOfDay']][] = [
  [/закат|золот\S* час|рассвет/iu, 'golden_hour'],
  [/(^|\s)ноч|полноч|до утра/iu, 'night'],
  [/вечер/iu, 'evening'],
  [/утр|завтрак/iu, 'morning'],
  [/днём|днем|обед|полдень/iu, 'day'],
];
const SEASON_RULES: [RegExp, TextAnalysis['season']][] = [
  [/зим|снег|мороз|сугроб/iu, 'winter'],
  [/осен|листопад|опавш/iu, 'autumn'],
  [/весн|капел|подснеж/iu, 'spring'],
  [/(^|\s)лет[оа](\s|[.,!?]|$)|летом|жара|пляж/iu, 'summer'],
];
const AIR_RULES: [RegExp, TextAnalysis['air'][number]][] = [
  [/какао|(^|\s)ча[йяю]|кофе|горяч|глинтвейн/iu, 'steam'],
  [/лист(ья|ьев|опад)/iu, 'leaves'],
  [/снег|снежин|метел/iu, 'snow'],
  [/дожд|ливен|ливн|морос/iu, 'rain'],
  [/пыл|солнечн\S* луч|чердак/iu, 'dust'],
  [/туман|дымк/iu, 'fog'],
];

const COLD = /(холод\S*|мороз\S*|дожд\S*|слякот\S*|ветр\S*|ветер|сыро\S*|серо\S*|устал\S*|мёрз\S*|мерз\S*|промок\S*)/iu;
const BUT = /[\s,]+(но|зато|однако|а потом|а дома)\s/iu;
const WARM = /(тепл\S*|какао|ча[йяю]|кофе|обня\S*|обним\S*|солнц\S*|смея\S*|смех\S*|уют\S*|плед\S*|пирог\S*|горяч\S*)/iu;

/** Те же якоря, что в client/src/recipe/presets.ts — здесь только для подсказки label. */
const ANCHORS: Record<ProcessId, [number, number]> = {
  cyanotype: [0.12, 0.82], autochrome: [0.33, 0.69], kodachrome: [0.69, 0.88], instant: [0.73, 0.63],
  trichrome: [0.93, 0.76], double_exposure: [0.22, 0.45], solarization: [0.56, 0.38],
  push_montage: [0.93, 0.21], platinum: [0.17, 0.22],
};

// ---------- названия папок ----------
type Gender = 'm' | 'f' | 'n' | 'pl';
type Noun = { re: RegExp; w: string; g: Gender };
const PLACES: Noun[] = [
  { re: /парк/iu, w: 'парк', g: 'm' }, { re: /офис/iu, w: 'офис', g: 'm' }, { re: /кухн/iu, w: 'кухня', g: 'f' },
  { re: /(^|\s)мор[еяю]/iu, w: 'море', g: 'n' }, { re: /(^|\s)лес/iu, w: 'лес', g: 'm' },
  { re: /(^|\s)дач/iu, w: 'дача', g: 'f' }, { re: /кафе|кофейн/iu, w: 'кафе', g: 'n' },
  { re: /город/iu, w: 'город', g: 'm' }, { re: /метро/iu, w: 'метро', g: 'n' }, { re: /вокзал/iu, w: 'вокзал', g: 'm' },
  { re: /(^|\s)гор(ы|ах|ам)/iu, w: 'горы', g: 'pl' }, { re: /(^|\s)рек[аеиу]/iu, w: 'река', g: 'f' },
  { re: /(^|\s)двор/iu, w: 'двор', g: 'm' }, { re: /улиц/iu, w: 'улица', g: 'f' },
  { re: /набережн/iu, w: 'набережная', g: 'f' }, { re: /балкон/iu, w: 'балкон', g: 'm' },
  { re: /пляж/iu, w: 'пляж', g: 'm' }, { re: /концерт/iu, w: 'концерт', g: 'm' }, { re: /озер/iu, w: 'озеро', g: 'n' },
];
const OBJECTS: Noun[] = [
  { re: /какао/iu, w: 'какао', g: 'n' }, { re: /кофе/iu, w: 'кофе', g: 'm' }, { re: /(^|\s)ча[йяю]/iu, w: 'чай', g: 'm' },
  { re: /пицц/iu, w: 'пицца', g: 'f' }, { re: /(^|\s)торт/iu, w: 'торт', g: 'm' }, { re: /книг/iu, w: 'книга', g: 'f' },
  { re: /гитар/iu, w: 'гитара', g: 'f' }, { re: /велосипед/iu, w: 'велосипед', g: 'm' },
  { re: /мандарин/iu, w: 'мандарины', g: 'pl' }, { re: /пирог/iu, w: 'пироги', g: 'pl' },
  { re: /(^|\s)блин/iu, w: 'блины', g: 'pl' }, { re: /мороженое/iu, w: 'мороженое', g: 'n' },
  { re: /фильм|(^|\s)кино/iu, w: 'кино', g: 'n' }, { re: /собак/iu, w: 'собака', g: 'f' },
  { re: /(^|\s)кот(\s|$|[.,!?])|кошк/iu, w: 'кот', g: 'm' }, { re: /снег/iu, w: 'снег', g: 'm' },
  { re: /дожд/iu, w: 'дождь', g: 'm' }, { re: /дедлайн/iu, w: 'дедлайн', g: 'm' },
  { re: /лист(ья|ьев)/iu, w: 'листья', g: 'pl' },
];
const PEOPLE: [RegExp, string][] = [
  [/бабушк/iu, 'у бабушки'], [/(^|\s)мам/iu, 'с мамой'], [/(^|\s)пап/iu, 'с папой'], [/друз/iu, 'с друзьями'],
  [/подруг/iu, 'с подругой'], [/сестр/iu, 'с сестрой'], [/(^|\s)брат/iu, 'с братом'], [/коллег/iu, 'с коллегами'],
];
const ADJ = (m: string, f: string, n: string, pl: string): Record<Gender, string> => ({ m, f, n, pl });
const SEASON_ADJ: Record<string, Record<Gender, string>> = {
  autumn: ADJ('осенний', 'осенняя', 'осеннее', 'осенние'),
  winter: ADJ('зимний', 'зимняя', 'зимнее', 'зимние'),
  spring: ADJ('весенний', 'весенняя', 'весеннее', 'весенние'),
  summer: ADJ('летний', 'летняя', 'летнее', 'летние'),
};
const TIME_ADJ: Record<string, Record<Gender, string>> = {
  morning: ADJ('утренний', 'утренняя', 'утреннее', 'утренние'),
  evening: ADJ('вечерний', 'вечерняя', 'вечернее', 'вечерние'),
  golden_hour: ADJ('вечерний', 'вечерняя', 'вечернее', 'вечерние'),
  night: ADJ('ночной', 'ночная', 'ночное', 'ночные'),
  day: ADJ('дневной', 'дневная', 'дневное', 'дневные'),
};
const TIME_NOUN: Record<string, string> = {
  morning: 'утро', day: 'день', golden_hour: 'закат', evening: 'вечер', night: 'ночь', unknown: 'день',
};
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября',
  'октября', 'ноября', 'декабря'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function folderNames(text: string, season: string, time: string, date: string, special: boolean): string[] {
  const place = PLACES.find((p) => p.re.test(text));
  const objects = OBJECTS.filter((o) => o.re.test(text));
  const [obj, obj2] = objects;
  const person = PEOPLE.find(([re]) => re.test(text))?.[1];
  const sAdj = SEASON_ADJ[season];
  const tAdj = TIME_ADJ[time];
  const tNoun = TIME_NOUN[time] ?? 'день';
  const out: string[] = [];

  if (special && /снег/iu.test(text)) out.push(cap(`первый снег ${person ?? (place ? `и ${place.w}` : 'за окном')}`));
  // явное время суток (ночь, вечер, утро) конкретнее сезона
  const timeFirst = time === 'night' || time === 'evening' || time === 'morning';
  const bySeason = place && obj && sAdj ? cap(`${sAdj[place.g]} ${place.w} и ${obj.w}`) : null;
  const byTime = place && obj && tAdj ? cap(`${tAdj[place.g]} ${place.w} и ${obj.w}`) : null;
  for (const n of timeFirst ? [byTime, bySeason] : [bySeason, byTime]) if (n) out.push(n);
  if (place && person && (tAdj ?? sAdj)) out.push(cap(`${(tAdj ?? sAdj)[place.g]} ${place.w} ${person}`));
  if (obj && person) out.push(cap(`${tNoun}, ${obj.w} ${person}`));
  if (place && obj) out.push(cap(`${tNoun}, ${place.w} и ${obj.w}`));
  if (obj && obj2) out.push(cap(`${tNoun}, ${obj.w} и ${obj2.w}`));
  if (obj && sAdj && person) out.push(cap(`${sAdj[obj.g]} ${obj.w} ${person}`));
  const [, m, d] = date.split('-').map(Number);
  out.push(cap(`${tNoun} ${d} ${MONTH_GEN[m - 1]}${obj ? ` и ${obj.w}` : ''}`));
  return [...new Set(out)].slice(0, 5);
}

// ---------- подпись: дословная цитата ----------
const SENSORY = /(тепл|холод|запах|пах|вкус|свет|солн|дожд|снег|ветер|ветр|какао|чай|кофе|смея|тиш|шум|мягк|горяч|рук|глаз|небо|лист|мор|огн|звёзд|звезд|музык|песн)/iu;
const TRIM_EDGE = /^[\s«"„“(—–-]+|[\s.,;:!?…»"”)—–-]+$/gu;

const CLAUSE_END = /[,;:]$/u;
const DASH = /^[—–-]$/u;

/**
 * 3–6 слов подряд из самого «чувственного» предложения. Всегда подстрока исходного текста.
 * Окно не рвёт оборот (не переходит через запятую) и тяготеет к целой фразе из ~4 слов.
 * Та же функция — в client/src/recipe/validate.ts (держать в синхроне).
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

function voiceStyle(energy: number, tone: number, together: number): string {
  const color = tone > 0.6 ? 'тепло, с лёгкой улыбкой' : tone > 0.4 ? 'ровно и мягко' : 'сдержанно, без надрыва';
  const pace =
    energy < 0.4
      ? 'неторопливо, с паузами'
      : energy < 0.7
        ? 'в спокойном живом темпе'
        : tone < 0.4
          ? 'быстрее обычного, с напряжением в голосе'
          : 'живо, с энергией в голосе';
  const who = together > 0.6 ? 'как будто рассказываешь близкому человеку' : 'как будто говоришь сам с собой';
  return `Говори ${color}, ${pace}, ${who}.`;
}

export function analyzeHeuristic(req: AnalyzeRequest): TextAnalysis {
  const text = req.text;
  const lower = text.toLowerCase();

  const exclam = Math.min(3, (text.match(/!/g) ?? []).length);
  const energy = clamp(0.45 + 0.1 * (count(lower, LEX.energyUp) - count(lower, LEX.energyDown)) + 0.04 * exclam);
  const tone = clamp(0.55 + 0.1 * (count(lower, LEX.toneUp) - count(lower, LEX.toneDown)));
  const together = clamp(0.35 + 0.12 * count(lower, LEX.together) - 0.15 * count(lower, LEX.alone));
  const special = clamp(0.25 + 0.2 * count(lower, LEX.special));

  let timeOfDay: TextAnalysis['timeOfDay'] = TIME_RULES.find(([re]) => re.test(text))?.[1] ?? 'unknown';
  if (timeOfDay === 'unknown' && req.takenAt[0]) {
    const h = new Date(req.takenAt[0]).getHours();
    if (!Number.isNaN(h)) {
      timeOfDay = h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : h < 19 ? 'golden_hour' : h < 22 ? 'evening' : 'night';
    }
  }
  let season: TextAnalysis['season'] = SEASON_RULES.find(([re]) => re.test(text))?.[1] ?? 'unknown';
  if (season === 'unknown') {
    const m = Number(req.date.slice(5, 7));
    season = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  }
  const air = [...new Set(AIR_RULES.filter(([re]) => re.test(text)).map(([, a]) => a))];

  let contrast: TextAnalysis['contrast'] = { has: false };
  for (const s of text.split(/(?<=[.!?…])\s+|\n+/u)) {
    const b = BUT.exec(s);
    if (!b) continue;
    const c = COLD.exec(s.slice(0, b.index));
    const w = WARM.exec(s.slice(b.index + b[0].length));
    if (c && w) {
      contrast = { has: true, cold: c[1].toLowerCase(), warm: w[1].toLowerCase() };
      break;
    }
  }

  let label: ProcessId = 'autochrome';
  let bestD = Infinity;
  for (const [id, [e, t]] of Object.entries(ANCHORS) as [ProcessId, [number, number]][]) {
    const d = Math.hypot(e - energy, t - tone);
    if (d < bestD) { bestD = d; label = id; }
  }

  return {
    atmosphere: { energy, tone, together, special },
    label,
    timeOfDay,
    season,
    contrast,
    air,
    captionQuote: pickCaption(text),
    folderNames: folderNames(text, season, timeOfDay, req.date, special > 0.5),
    voiceStyle: voiceStyle(energy, tone, together),
    // TODO: выбор «кадра дня» по смыслу текста появится вместе с LLM (photoNotes); пока — первое фото
    bestPhotoIndex: 0,
    photoNotes: [],
  };
}
