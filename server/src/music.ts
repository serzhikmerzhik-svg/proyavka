/**
 * Музыка (SPEC §4.1): поиск в Deezer с запасным iTunes, детали трека, прокси 30-секундного превью.
 * Аудио на диск не сохраняется — превью стримится клиенту на лету при каждом просмотре.
 */
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export type SongCandidate = {
  source: 'deezer' | 'itunes';
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
  year?: number;
  genre?: string;
  link?: string;
  hasPreview: boolean;
};

const UA = { 'User-Agent': 'proyavka/0.1 (hackathon prototype)' };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ответил ${r.status}`);
  return (await r.json()) as T;
}

const yearOf = (s?: string) => {
  const y = Number(s?.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : undefined;
};

// ---------- Deezer ----------
type DzTrack = {
  id: number; title: string; link?: string; preview?: string; bpm?: number; release_date?: string;
  artist: { name: string }; album: { id: number; cover_medium?: string; cover_big?: string };
};

async function deezerSearch(q: string): Promise<SongCandidate[]> {
  const j = await getJson<{ data?: DzTrack[]; error?: unknown }>(
    `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=8`,
  );
  if (j.error) throw new Error('Deezer вернул ошибку');
  return (j.data ?? []).map((t) => ({
    source: 'deezer' as const,
    id: String(t.id),
    title: t.title,
    artist: t.artist.name,
    coverUrl: t.album.cover_medium,
    link: t.link,
    hasPreview: Boolean(t.preview),
  }));
}

async function deezerTrack(id: string) {
  const t = await getJson<DzTrack & { error?: unknown }>(`https://api.deezer.com/track/${encodeURIComponent(id)}`);
  if (t.error) throw new Error('Трек не найден в Deezer');
  return t;
}

async function deezerDetails(id: string): Promise<SongCandidate & { bpm?: number }> {
  const t = await deezerTrack(id);
  let genre: string | undefined;
  try {
    const album = await getJson<{ genres?: { data?: { name: string }[] } }>(`https://api.deezer.com/album/${t.album.id}`);
    genre = album.genres?.data?.[0]?.name;
  } catch {
    // жанр — необязательная подсказка
  }
  return {
    source: 'deezer', id: String(t.id), title: t.title, artist: t.artist.name,
    coverUrl: t.album.cover_big ?? t.album.cover_medium, link: t.link,
    year: yearOf(t.release_date), genre, hasPreview: Boolean(t.preview),
    bpm: t.bpm && t.bpm > 0 ? t.bpm : undefined,
  };
}

// ---------- iTunes ----------
type ItTrack = {
  trackId: number; trackName: string; artistName: string; artworkUrl100?: string; releaseDate?: string;
  primaryGenreName?: string; previewUrl?: string; trackViewUrl?: string;
};
const itunesCandidate = (t: ItTrack): SongCandidate => ({
  source: 'itunes', id: String(t.trackId), title: t.trackName, artist: t.artistName,
  coverUrl: t.artworkUrl100?.replace('100x100', '300x300'), year: yearOf(t.releaseDate),
  genre: t.primaryGenreName, link: t.trackViewUrl, hasPreview: Boolean(t.previewUrl),
});

async function itunesSearch(q: string): Promise<SongCandidate[]> {
  const j = await getJson<{ results?: ItTrack[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=8`,
  );
  return (j.results ?? []).map(itunesCandidate);
}
async function itunesLookup(id: string): Promise<ItTrack | undefined> {
  const j = await getJson<{ results?: ItTrack[] }>(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song`);
  return j.results?.find((r) => String(r.trackId) === id) ?? j.results?.[0];
}

// ---------- ссылки ----------
/** Ссылка → прямой трек Deezer/iTunes или текстовый запрос (через oEmbed). */
async function resolveLink(raw: string): Promise<{ deezerId?: string; itunesId?: string; query?: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { query: raw };
  }
  const host = url.hostname.replace(/^www\./, '');

  // короткие ссылки Deezer — раскрываем редирект
  if (/^(deezer\.page\.link|link\.deezer\.com|dzr\.page\.link)$/.test(host)) {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      url = new URL(r.url);
    } catch {
      return {};
    }
  }
  const dz = /deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/.exec(url.href);
  if (dz) return { deezerId: dz[1] };

  if (host === 'music.apple.com' && url.searchParams.get('i')) return { itunesId: url.searchParams.get('i')! };

  const oembed: Record<string, string> = {
    'open.spotify.com': 'https://open.spotify.com/oembed?url=',
    'youtube.com': 'https://www.youtube.com/oembed?format=json&url=',
    'music.youtube.com': 'https://www.youtube.com/oembed?format=json&url=',
    'youtu.be': 'https://www.youtube.com/oembed?format=json&url=',
    'soundcloud.com': 'https://soundcloud.com/oembed?format=json&url=',
  };
  const endpoint = oembed[host];
  if (!endpoint) return {};
  try {
    const o = await getJson<{ title?: string; author_name?: string }>(endpoint + encodeURIComponent(url.href));
    let title = (o.title ?? '').replace(/\s*[([](official|lyric|audio|video|клип|hd|4k)[^)\]]*[)\]]/giu, '').trim();
    // у YouTube автор — часто «Artist - Topic» или «ArtistVEVO»
    const author = (o.author_name ?? '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    if (host.includes('youtu') && author && !title.toLowerCase().includes(author.toLowerCase())) title = `${author} ${title}`;
    return title ? { query: title } : {};
  } catch {
    return {};
  }
}

// ---------- обработчики ----------
export async function searchHandler(req: Request, res: Response) {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.status(400).json({ error: 'Пустой запрос' });
    return;
  }
  try {
    let query = q;
    if (/^https?:\/\//i.test(q)) {
      const link = await resolveLink(q);
      if (link.deezerId) {
        res.json({ results: [await deezerDetails(link.deezerId)], via: 'link' });
        return;
      }
      if (link.itunesId) {
        const t = await itunesLookup(link.itunesId);
        res.json({ results: t ? [itunesCandidate(t)] : [], via: 'link' });
        return;
      }
      if (!link.query) {
        res.json({ results: [], via: 'link', note: 'Не удалось прочитать ссылку — введите «исполнитель — название»' });
        return;
      }
      query = link.query;
    }
    const search = query.replace(/\s+[—–-]\s+/u, ' ');
    try {
      const results = await deezerSearch(search);
      if (results.length) {
        res.json({ results, via: 'deezer', query });
        return;
      }
    } catch (e) {
      console.warn('[music] Deezer недоступен, пробуем iTunes:', (e as Error).message);
    }
    res.json({ results: await itunesSearch(search), via: 'itunes', query });
  } catch (e) {
    res.status(502).json({ error: 'Поиск музыки не удался: ' + (e as Error).message });
  }
}

/** Детали трека после подтверждения: год, жанр, подсказка BPM (Deezer). */
export async function trackHandler(req: Request, res: Response) {
  const source = String(req.query.source);
  const id = String(req.query.id ?? '');
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  try {
    if (source === 'deezer') {
      const d = await deezerDetails(id);
      if (!d.hasPreview) {
        // у Deezer нет превью (права в регионе) — ищем тот же трек в iTunes
        const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        try {
          const alt = (await itunesSearch(`${d.artist} ${d.title}`)).find(
            (c) => c.hasPreview && norm(c.artist).includes(norm(d.artist)) && norm(c.title).startsWith(norm(d.title).slice(0, 12)),
          );
          if (alt) {
            res.json({ ...alt, coverUrl: d.coverUrl ?? alt.coverUrl, year: d.year ?? alt.year, genre: d.genre ?? alt.genre, previewFrom: 'itunes' });
            return;
          }
        } catch {
          // iTunes недоступен — остаётся ручной ввод или свой файл
        }
      }
      res.json(d);
      return;
    }
    if (source === 'itunes') {
      const t = await itunesLookup(id);
      if (!t) throw new Error('Трек не найден');
      res.json(itunesCandidate(t));
      return;
    }
    res.status(400).json({ error: 'Неизвестный источник' });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
}

const PREVIEW_HOSTS = /(^|\.)(dzcdn\.net|deezer\.com|mzstatic\.com|apple\.com)$/;

/** Свежее превью каждый раз: ссылки Deezer подписаны и истекают. */
export async function previewHandler(req: Request, res: Response) {
  const source = String(req.query.source);
  const id = String(req.query.id ?? '');
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  try {
    let previewUrl: string | undefined;
    if (source === 'deezer') {
      const t = await deezerTrack(id);
      previewUrl = t.preview || undefined;
      if (t.bpm && t.bpm > 0) res.setHeader('X-Deezer-Bpm', String(t.bpm));
    } else if (source === 'itunes') {
      previewUrl = (await itunesLookup(id))?.previewUrl;
    }
    if (!previewUrl) {
      res.status(404).json({ error: 'У этого трека нет превью — загрузите свой аудиофайл' });
      return;
    }
    if (!PREVIEW_HOSTS.test(new URL(previewUrl).hostname)) throw new Error('Неожиданный адрес превью');

    const upstream = await fetch(previewUrl, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!upstream.ok || !upstream.body) throw new Error(`Превью недоступно (${upstream.status})`);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Cache-Control', 'no-store');
    Readable.fromWeb(upstream.body as unknown as WebReadableStream).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: (e as Error).message });
    else res.end();
  }
}
