/** Сквозной путь «Экспонировать → Проявить»: фото → музыка → анализ текста → рецепт → сохранение. */
import { preparePhoto } from './photos';
import { addDepthToDay } from './depth';
import { addVoiceToDay } from '../audio/voice';
import { manualMusicFeatures } from './music';
import { analyzeAudio, decodeAudio, fetchPreview } from './audioFeatures';
import { keyRu } from './key';
import { buildRecipe, musicEnergy } from '../recipe/buildRecipe';
import { checkCaption, checkFolderNames } from '../recipe/validate';
import { PROCESS_NAMES } from '../recipe/presets';
import { saveDay } from '../storage/db';
// общий с сервером модуль без Node-зависимостей: без сервера анализ идёт прямо в браузере
import { analyzeHeuristic } from '../../../server/src/heuristic';
import type { Day, MusicFeatures, PhotoAsset, SongRef, TextAnalysis } from '../recipe/types';

export type SongChoice = {
  ref: SongRef;
  /** свой аудиофайл (ref.source = 'file') */
  file?: File;
  /** подсказка темпа из Deezer */
  bpmHint?: number;
  /** запасной вариант, если аудио нет: темп и лад «на слух» */
  manual: { bpm: number; mode: 'major' | 'minor' };
};

export type ExposeInput = {
  text: string;
  date: string;
  files: File[];
  song: SongChoice;
  useMeta: boolean;
};

const TIME_RU: Record<TextAnalysis['timeOfDay'], string> = {
  morning: 'утро', day: 'день', golden_hour: 'золотой час', evening: 'вечер', night: 'ночь', unknown: 'время не ясно',
};
const ERA_RU: Record<NonNullable<MusicFeatures['era']>, string> = {
  midcentury: 'до 1965', seventies: '1965–1984', nineties: '1985–1999', digicam: '2000–2012', modern: 'с 2013',
};

type AnalyzeResponse = {
  analysis: TextAnalysis;
  source: 'llm' | 'heuristic';
  provider?: 'anthropic' | 'openai';
  model?: string;
  attempts: number;
  fallbackReason?: string;
};

const PROVIDER_RU = { anthropic: 'Claude', openai: 'OpenAI' } as const;

/** Кадр для модели: JPEG до 768 px по длинной стороне, base64 без префикса. */
async function photoForModel(blob: Blob): Promise<{ mediaType: 'image/jpeg'; data: string }> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

async function analyzeText(input: ExposeInput, photos: PhotoAsset[], takenAt: string[]): Promise<AnalyzeResponse> {
  const request = {
    text: input.text,
    date: input.date,
    photoCount: photos.length,
    takenAt,
    song: {
      title: input.song.ref.title,
      artist: input.song.ref.artist,
      year: input.song.ref.year,
      genre: input.song.ref.genre,
    },
  };
  let reason: string;
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, photos: await Promise.all(photos.map((p) => photoForModel(p.blob))) }),
    });
    if (res.ok) return (await res.json()) as AnalyzeResponse;
    reason = `сервер ответил ${res.status}`;
  } catch (e) {
    reason = `сервер недоступен (${(e as Error).message})`;
  }
  // Без сервера (GitHub Pages, офлайн) — та же эвристика, что на сервере, прямо в браузере
  return {
    analysis: analyzeHeuristic({ ...request, photos: [] }),
    source: 'heuristic',
    attempts: 0,
    fallbackReason: `${reason} — анализ эвристикой в браузере`,
  };
}

async function analyzeMusic(song: SongChoice, log: (l: string) => void): Promise<MusicFeatures> {
  const { ref } = song;
  let data: ArrayBuffer | undefined;
  let hint = song.bpmHint;
  try {
    if (ref.source === 'file' && song.file) {
      data = await song.file.arrayBuffer();
      log('Звук: свой файл');
    } else if ((ref.source === 'deezer' || ref.source === 'itunes') && ref.id) {
      const p = await fetchPreview(ref.source, ref.id);
      data = p.data;
      hint = p.bpmHint ?? hint;
      log(`Звук: превью ${ref.source === 'deezer' ? 'Deezer' : 'iTunes'}${hint ? ` · подсказка темпа ${hint}` : ''}`);
    }
  } catch (e) {
    log(`Превью недоступно: ${(e as Error).message}`);
  }

  if (!data) {
    const m = manualMusicFeatures(hint ?? song.manual.bpm, song.manual.mode, ref.year);
    log(`Без аудио: ${m.bpm} BPM · ${m.mode === 'major' ? 'мажор' : 'минор'} (по метаданным и вашему вводу)`);
    return m;
  }

  let result;
  try {
    result = await analyzeAudio(await decodeAudio(data), { bpmHint: hint, year: ref.year });
  } catch (e) {
    const m = manualMusicFeatures(song.manual.bpm, song.manual.mode, ref.year);
    log(`Аудио не разобрать (${(e as Error).message}) — беру ${m.bpm} BPM · ${m.mode === 'major' ? 'мажор' : 'минор'} из ручного ввода`);
    return m;
  }
  const { features: f, tempo } = result;
  log(`Темп: ${f.bpm} BPM — ${tempo.reason}`);
  log(`Первая доля: ${f.beatOffset.toFixed(2)} с · такт ${f.barSeconds.toFixed(2)} с`);
  log(`Тональность: ${keyRu(f.key, f.mode)} · уверенность ${f.modeConfidence.toFixed(2)}`);
  log(`Яркость ${f.brightness.toFixed(2)} · громкость ${f.rmsMean.toFixed(2)} · огибающая ${f.rmsEnvelope.length} точек`);
  if (f.era) log(`Эпоха: ${ERA_RU[f.era]}${ref.year ? ` (${ref.year})` : ''}`);
  return f;
}

export async function exposeDay(input: ExposeInput, log: (line: string) => void): Promise<Day> {
  log(`Плёнка заряжена: кадров — ${input.files.length}`);
  const photos: PhotoAsset[] = [];
  for (const [i, f] of input.files.entries()) {
    const p = await preparePhoto(f, input.useMeta);
    photos.push(p);
    log(`Кадр ${i + 1}: палитра ${p.palette.slice(0, 3).join(' ')}${p.takenAt ? ' · снят в ' + new Date(p.takenAt).toTimeString().slice(0, 5) : ''}`);
  }

  const music = await analyzeMusic(input.song, log);

  const takenAt = input.useMeta ? photos.flatMap((p) => (p.takenAt ? [p.takenAt] : [])) : [];
  const res = await analyzeText(input, photos, takenAt);
  const analysis = res.analysis;
  log(
    res.source === 'llm'
      ? `Смысл слов и кадров: ${PROVIDER_RU[res.provider ?? 'anthropic']} · ${res.model}${res.attempts > 1 ? ' · со второй попытки' : ''}`
      : `Смысл слов: эвристика по ключевым словам — ${res.fallbackReason ?? 'модель не настроена'}`,
  );
  for (const note of analysis.photoNotes) {
    log(`Кадр ${note.index + 1}: ${note.scene}${note.people ? ' · люди' : ''}${note.index === analysis.bestPhotoIndex ? ' · кадр дня' : ''}`);
  }
  const a = analysis.atmosphere;
  log(
    `Атмосфера по словам дня: ${TIME_RU[analysis.timeOfDay]} · ` +
      (a.together > 0.6 ? 'вместе' : a.together < 0.35 ? 'наедине' : 'свой ритм') +
      (analysis.contrast.has ? ` · ${analysis.contrast.cold}, но ${analysis.contrast.warm}` : ''),
  );

  // Проверки на клиенте: дословная подпись и название папки (SPEC §4.4)
  const caption = checkCaption(analysis.captionQuote, input.text);
  if (caption.replaced) log(`Подпись «${analysis.captionQuote}» отклонена (${caption.reason}) — беру «${caption.caption}»`);
  const folder = checkFolderNames(analysis.folderNames, input.date);
  for (const r of folder.rejected) log(`Название «${r.name}» отклонено: ${r.reason}`);

  const recipe = buildRecipe({ text: input.text, date: input.date, analysis, music, photos });
  log(
    `Оси: энергия ${recipe.atmosphere.energy.toFixed(2)} (слова ${a.energy.toFixed(2)}, музыка ${musicEnergy(music).toFixed(2)}) · ` +
      `тон ${recipe.atmosphere.tone.toFixed(2)} (слова ${a.tone.toFixed(2)}, ${music.mode === 'major' ? 'мажор' : 'минор'})`,
  );
  log(`Процесс: ${recipe.process.map((p) => `${PROCESS_NAMES[p.id]} ${Math.round(p.weight * 100)}%`).join(' + ')}`);
  log(
    `Ритм: проявка ${recipe.rhythm.developBars} такта · кадр ${recipe.rhythm.frameHoldBars} такта · ` +
      (recipe.rhythm.transition === 'cut' ? 'склейки' : 'наплывы'),
  );
  log(`Папка: «${recipe.folderName}»`);

  const day: Day = {
    id: crypto.randomUUID(),
    date: input.date,
    folderName: recipe.folderName,
    text: input.text,
    photos,
    song: input.song.ref,
    analysis: { ...analysis, music },
    recipe,
    audioFile: input.song.ref.source === 'file' ? input.song.file : undefined,
    createdAt: Date.now(),
  };
  await saveDay(day);
  // Глубина кадров (Depth Anything V2 Small) — в фоне: отпечаток уже можно проявлять,
  // параллакс и туман появятся, когда карты будут готовы
  log('Глубина кадров считается в фоне — снимок оживёт, когда она будет готова');
  void addDepthToDay(day.id);
  // озвучка со стилем из recipe.voice — тоже в фоне; без ключа сервер скажет, что она выключена
  void addVoiceToDay(day.id);
  return day;
}
