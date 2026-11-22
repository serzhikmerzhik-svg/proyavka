/**
 * Папка дня в ZIP (SPEC §7.7): `YYYY-MM-DD Название/` с text.md, photos/, depth/, song.json (без аудио),
 * recipe.json, print.png, voice.mp3, memory.webm и motion.mp4 (ИИ-оживление) — если они есть.
 * Аудио песни в папку не кладём никогда: только ID и метаданные (SPEC §9).
 */
import JSZip from 'jszip';
import { PROCESS_NAMES } from '../recipe/presets';
import { providerName } from '../ai/motion';
import type { Day } from '../recipe/types';

const pad = (i: number) => String(i).padStart(2, '0');

export const dayFolderName = (day: Pick<Day, 'date' | 'folderName'>) => `${day.date} ${day.folderName}`;

export function textMd(day: Day): string {
  const r = day.recipe;
  return [
    `# ${day.folderName}`,
    '',
    `${day.date} · «${r.caption}»`,
    '',
    day.text,
    '',
    '---',
    '',
    `Песня: ${day.song.artist} — ${day.song.title}${day.song.year ? ` (${day.song.year})` : ''}`,
    `Процесс: ${r.process.map((p) => `${PROCESS_NAMES[p.id]} ${Math.round(p.weight * 100)}%`).join(' + ')}`,
    ...(day.motion
      ? [
          `ИИ-оживление: кадр ${day.motion.photoIndex + 1}, ${providerName(day.motion.provider)} ${day.motion.model} — ` +
            `движение деталей сгенерировано нейросетью (motion.${motionExt(day.motion.blob)})`,
        ]
      : []),
    '',
    'Почему так:',
    ...r.why.map((w) => `- ${w}`),
    '',
  ].join('\n');
}

/** Метаданные песни и признаки музыки. Никакого аудио. */
export function songJson(day: Day) {
  return { ...day.song, music: day.analysis.music };
}

export type DayZipExtras = { printPng?: Blob; memoryWebm?: Blob };

/** Видео-API отдаёт mp4; другое расширение — только если пришёл другой контейнер. */
export const motionExt = (blob: Blob) => (blob.type.includes('webm') ? 'webm' : 'mp4');

export async function buildDayZip(day: Day, extras: DayZipExtras = {}): Promise<JSZip> {
  const zip = new JSZip();
  const dir = zip.folder(dayFolderName(day))!;
  dir.file('text.md', textMd(day));
  for (const [i, photo] of day.photos.entries()) {
    dir.file(`photos/${pad(i + 1)}.jpg`, await photo.blob.arrayBuffer());
    if (photo.depth) dir.file(`depth/${pad(i + 1)}.png`, await photo.depth.arrayBuffer());
  }
  dir.file('song.json', JSON.stringify(songJson(day), null, 2));
  dir.file('recipe.json', JSON.stringify(day.recipe, null, 2));
  if (extras.printPng) dir.file('print.png', await extras.printPng.arrayBuffer());
  if (day.voice) dir.file('voice.mp3', await day.voice.arrayBuffer());
  const memory = extras.memoryWebm ?? day.memory;
  if (memory) dir.file('memory.webm', await memory.arrayBuffer());
  if (day.motion) dir.file(`motion.${motionExt(day.motion.blob)}`, await day.motion.blob.arrayBuffer());
  return zip;
}

/** Собрать и отдать браузеру как файл «YYYY-MM-DD Название.zip». */
export async function downloadDayZip(day: Day, extras: DayZipExtras = {}): Promise<void> {
  const blob = await (await buildDayZip(day, extras)).generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${dayFolderName(day)}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
