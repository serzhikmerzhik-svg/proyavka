import type { MusicFeatures } from '../recipe/types';

export function eraFromYear(year?: number): MusicFeatures['era'] {
  if (!year) return undefined;
  if (year < 1965) return 'midcentury';
  if (year < 1985) return 'seventies';
  if (year < 2000) return 'nineties';
  if (year < 2013) return 'digicam';
  return 'modern';
}

/**
 * Признаки музыки из ручного ввода (темп и лад указывает пользователь).
 * TODO: на следующем шаге — превью Deezer → beat detector + Meyda + Крумхансл (SPEC §4.2).
 */
export function manualMusicFeatures(bpm: number, mode: 'major' | 'minor', year?: number): MusicFeatures {
  const safeBpm = Math.min(200, Math.max(40, Math.round(bpm) || 96));
  return {
    bpm: safeBpm,
    beatOffset: 0,
    barSeconds: (4 * 60) / safeBpm,
    rmsEnvelope: [],
    rmsMean: 0.5,
    brightness: 0.5,
    key: '—',
    mode,
    modeConfidence: 0,
    era: eraFromYear(year),
    source: 'manual',
  };
}

/** Разбор строки «исполнитель — название» (дефис, тире или длинное тире). */
export function parseSongQuery(q: string): { artist: string; title: string } | null {
  const m = q.split(/\s+[—–-]\s+/u);
  if (m.length < 2) return null;
  const artist = m[0].trim();
  const title = m.slice(1).join(' — ').trim();
  return artist && title ? { artist, title } : null;
}
