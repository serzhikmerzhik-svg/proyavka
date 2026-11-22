/**
 * Демо-режим (SPEC §9): 5 готовых дней из public/demo с готовыми рецептами — работает без ключей.
 * Карты глубины и миниатюры досчитываются в браузере при первом просмотре; песня — превью Deezer.
 */
import { db } from './db';
import type { Day, MusicFeatures, Recipe, SongRef, TextAnalysis } from '../recipe/types';

type DemoIndex = { slug: string; date: string; folderName: string }[];
type DemoDay = {
  date: string;
  text: string;
  song: SongRef;
  photos: { file: string; width: number; height: number; palette: string[] }[];
};

const json = async <T>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
};

export const isDemoDay = (d: Pick<Day, 'id' | 'demo'>) => d.demo === true || d.id.startsWith('demo-');

/** Загрузить (или обновить) все демо-дни. Возвращает их число. */
export async function importDemoDays(): Promise<number> {
  // BASE_URL — «/» локально и «/<репозиторий>/» на GitHub Pages
  const index = await json<DemoIndex>(`${import.meta.env.BASE_URL}demo/index.json`);
  for (const [i, item] of index.entries()) {
    const base = `${import.meta.env.BASE_URL}demo/${item.slug}`;
    const [day, analysis, recipe] = await Promise.all([
      json<DemoDay>(`${base}/day.json`),
      json<TextAnalysis & { music: MusicFeatures }>(`${base}/analysis.json`),
      json<Recipe>(`${base}/recipe.json`),
    ]);
    const photos = await Promise.all(
      day.photos.map(async (p) => {
        const r = await fetch(`${base}/photos/${p.file}`);
        if (!r.ok) throw new Error(`${base}/photos/${p.file}: ${r.status}`);
        return { blob: await r.blob(), width: p.width, height: p.height, palette: p.palette };
      }),
    );
    const record: Day = {
      id: `demo-${item.slug}`,
      demo: true,
      date: day.date,
      folderName: recipe.folderName,
      text: day.text,
      photos,
      song: day.song,
      analysis,
      recipe,
      createdAt: Date.now() - (index.length - i) * 1000,
    };
    await db.days.put(record);
  }
  return index.length;
}

export async function removeDemoDays(): Promise<number> {
  const ids = (await db.days.toArray()).filter(isDemoDay).map((d) => d.id);
  await db.days.bulkDelete(ids);
  return ids.length;
}
