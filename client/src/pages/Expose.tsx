import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SongPicker } from '../ui/SongPicker';
import { useObjectUrls } from '../ui/useObjectUrls';
import { ThemePicker } from '../ui/theme';
import { exposeDay, type SongChoice } from '../analysis/pipeline';

const MAX_PHOTOS = 6;
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD

export default function Expose() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [date, setDate] = useState(today);
  const [files, setFiles] = useState<File[]>([]);
  const [song, setSong] = useState<SongChoice | null>(null);
  const [useMeta, setUseMeta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);

  const previews = useObjectUrls(files);

  const onSong = useCallback((c: SongChoice | null) => setSong(c), []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const images = [...list].filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...images].slice(0, MAX_PHOTOS));
  };

  const ready = text.trim().length > 0 && files.length > 0 && song !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !song) return;
    setBusy(true);
    setError(undefined);
    setLog([]);
    try {
      const day = await exposeDay({ text: text.trim(), date, files, song, useMeta }, (line) => setLog((l) => [...l, line]));
      navigate(`/day/${day.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page expose">
      <header className="topbar">
        <Link to="/#archive" className="mono">← контактный лист</Link>
        <h1>Экспонировать день</h1>
        <ThemePicker />
      </header>

      <form onSubmit={submit} className="expose-form">
        <label className="field">
          <span className="mono label">дата</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        <label className="field">
          <span className="mono label">как прошёл день</span>
          <textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Было холодно, но мы пили какао в парке и долго смеялись…"
          />
        </label>

        <div className="field">
          <span className="mono label">кадры · {files.length}/{MAX_PHOTOS}</span>
          <label
            className={`dropzone${drag ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            {files.length === 0 ? (
              <span className="mono dim">Перетащите 1–6 фото или нажмите</span>
            ) : (
              <span className="thumbs">
                {previews.map((u, i) => (
                  <span key={u} className="thumb">
                    <img src={u} alt="" />
                    <button
                      type="button"
                      aria-label="Убрать кадр"
                      onClick={(e) => {
                        e.preventDefault();
                        setFiles((f) => f.filter((_, j) => j !== i));
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </span>
            )}
          </label>
        </div>

        <div className="field">
          <span className="mono label">песня дня</span>
          <SongPicker onChange={onSong} />
        </div>

        <label className="check">
          <input type="checkbox" checked={useMeta} onChange={(e) => setUseMeta(e.target.checked)} />
          <span>Использовать время и место съёмки из фото</span>
        </label>

        <button className="btn primary" type="submit" disabled={!ready || busy}>
          {busy ? 'Проявляю…' : 'Проявить'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>

      {log.length > 0 && (
        <section className="journal" aria-live="polite">
          <h2 className="mono">Лабораторный журнал</h2>
          <ol>
            {log.map((l, i) => (
              <li key={i} className="mono">{l}</li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
