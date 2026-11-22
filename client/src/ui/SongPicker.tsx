import { useEffect, useState } from 'react';
import { parseSongQuery } from '../analysis/music';
import type { SongChoice } from '../analysis/pipeline';
import type { SongRef } from '../recipe/types';

type Candidate = {
  source: 'deezer' | 'itunes';
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
  year?: number;
  genre?: string;
  link?: string;
  hasPreview: boolean;
  bpm?: number;
};

type Props = { onChange: (choice: SongChoice | null) => void };

export function SongPicker({ onChange }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Candidate | null>(null);
  const [ref, setRef] = useState<SongRef | null>(null);
  const [hasPreview, setHasPreview] = useState(false);
  const [bpmHint, setBpmHint] = useState<number>();
  const [file, setFile] = useState<File>();
  const [manualBpm, setManualBpm] = useState(96);
  const [mode, setMode] = useState<'major' | 'minor'>('major');

  useEffect(() => {
    onChange(ref ? { ref, file, bpmHint, manual: { bpm: manualBpm, mode } } : null);
  }, [ref, file, bpmHint, manualBpm, mode, onChange]);

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setNote(undefined);
    setResults([]);
    try {
      const r = await fetch(`/api/music/search?q=${encodeURIComponent(query.trim())}`).catch(() => null);
      const j = r && ((await r.json().catch(() => null)) as { results?: Candidate[]; error?: string; note?: string; via?: string } | null);
      if (!r || !r.ok || !j) {
        // без сервера (GitHub Pages) поиска нет: свой аудиофайл или «исполнитель — название» работают и так
        throw new Error(j?.error ?? (!r || r.status === 404 || r.status === 405 ? 'Поиск песен работает только вместе с сервером' : 'Поиск не удался'));
      }
      setResults(j.results ?? []);
      if (j.note) setNote(j.note);
      else if (!j.results?.length) setNote('Ничего не нашлось. Можно ввести «исполнитель — название» без поиска.');
      if (j.via === 'link' && j.results?.length === 1) setPending(j.results[0]);
    } catch (e) {
      setNote(`${(e as Error).message}. Можно продолжить без поиска.`);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(c: Candidate) {
    setPending(null);
    setBusy(true);
    let d: Candidate = c;
    try {
      const r = await fetch(`/api/music/track?source=${c.source}&id=${c.id}`);
      if (r.ok) d = { ...c, ...((await r.json()) as Candidate) };
    } catch {
      // детали необязательны — год и жанр просто не попадут в рецепт
    }
    setBusy(false);
    setRef({ source: d.source, id: d.id, title: d.title, artist: d.artist, year: d.year, genre: d.genre, coverUrl: d.coverUrl, link: d.link });
    setHasPreview(d.hasPreview);
    setBpmHint(d.bpm);
    setFile(undefined);
  }

  function manual() {
    const parsed = parseSongQuery(query);
    if (!parsed) {
      setNote('Формат: «исполнитель — название»');
      return;
    }
    setRef({ source: 'manual', ...parsed });
    setHasPreview(false);
    setBpmHint(undefined);
  }

  function ownFile(f: File | undefined) {
    if (!f) return;
    const parsed = parseSongQuery(query) ?? parseSongQuery(f.name.replace(/\.[^.]+$/, ''));
    setFile(f);
    setRef({ source: 'file', title: parsed?.title ?? f.name.replace(/\.[^.]+$/, ''), artist: parsed?.artist ?? 'свой файл' });
    setHasPreview(true);
    setBpmHint(undefined);
  }

  function reset() {
    setRef(null);
    setFile(undefined);
    setResults([]);
  }

  const fileInput = (
    <label className="btn ghost small">
      Свой аудиофайл
      <input type="file" accept="audio/*" hidden onChange={(e) => ownFile(e.target.files?.[0])} />
    </label>
  );

  if (ref) {
    return (
      <div className="song-chosen">
        {ref.coverUrl ? <img src={ref.coverUrl} alt="" /> : <div className="cover-blank">♪</div>}
        <div className="song-meta">
          <div className="song-title">{ref.title}</div>
          <div className="mono dim">
            {ref.artist}
            {ref.year ? ` · ${ref.year}` : ''}
            {ref.genre ? ` · ${ref.genre}` : ''}
          </div>
          <div className="mono small">
            {ref.source === 'file'
              ? 'свой файл — проанализирую в браузере'
              : hasPreview
                ? `превью ${ref.source === 'itunes' ? 'iTunes' : 'Deezer'} — проанализирую темп и лад`
                : 'превью нет — укажите темп на слух или загрузите файл'}
            {bpmHint ? ` · Deezer: ${bpmHint} BPM` : ''}
          </div>
          {!hasPreview && (
            <div className="manual-row">
              <label className="mono small">
                темп на слух
                <input type="number" min={40} max={200} value={manualBpm} onChange={(e) => setManualBpm(Number(e.target.value))} />
              </label>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'major' | 'minor')}>
                <option value="major">мажор</option>
                <option value="minor">минор</option>
              </select>
              {fileInput}
            </div>
          )}
        </div>
        <button type="button" className="btn ghost small" onClick={reset}>Сменить</button>
      </div>
    );
  }

  return (
    <div className="song-picker">
      <div className="row">
        <input
          type="text"
          placeholder="Исполнитель — название или ссылка Deezer / Spotify / YouTube"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" className="btn" onClick={() => void search()} disabled={busy}>
          {busy ? '…' : 'Найти'}
        </button>
      </div>
      {note && <p className="mono small dim">{note}</p>}

      {pending && (
        <div className="confirm">
          {pending.coverUrl && <img src={pending.coverUrl} alt="" />}
          <div>
            <p className="caveat big">Это она?</p>
            <p>{pending.title}</p>
            <p className="mono dim">{pending.artist}</p>
            <div className="row">
              <button type="button" className="btn" onClick={() => void confirm(pending)}>Да, она</button>
              <button type="button" className="btn ghost" onClick={() => setPending(null)}>Нет, другая</button>
            </div>
          </div>
        </div>
      )}

      {!pending && results.length > 0 && (
        <ul className="results">
          {results.map((c) => (
            <li key={`${c.source}-${c.id}`}>
              <button type="button" onClick={() => setPending(c)}>
                {c.coverUrl ? <img src={c.coverUrl} alt="" /> : <span className="cover-blank">♪</span>}
                <span>
                  <span className="song-title">{c.title}</span>
                  <span className="mono dim small">{c.artist}{c.hasPreview ? '' : ' · без превью'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <button type="button" className="btn ghost small" onClick={manual}>Без поиска</button>
        {fileInput}
      </div>
    </div>
  );
}
