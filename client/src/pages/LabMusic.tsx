/** /lab/music — отладка признаков музыки: темп не удваивается, тональность, огибающая. */
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { SongPicker } from '../ui/SongPicker';
import { analyzeAudio, decodeAudio, fetchPreview } from '../analysis/audioFeatures';
import { keyRu } from '../analysis/key';
import type { SongChoice } from '../analysis/pipeline';

type Row = { song: string; detected: number; hint?: number; chosen: number; reason: string; key: string; offset: number; rms: number; bright: number };

export default function LabMusic() {
  const [song, setSong] = useState<SongChoice | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const onSong = useCallback((c: SongChoice | null) => setSong(c), []);

  async function run() {
    if (!song) return;
    setBusy(true);
    setError(undefined);
    try {
      const { ref } = song;
      let data: ArrayBuffer;
      let hint = song.bpmHint;
      if (ref.source === 'file' && song.file) data = await song.file.arrayBuffer();
      else if (ref.id && (ref.source === 'deezer' || ref.source === 'itunes')) {
        const p = await fetchPreview(ref.source, ref.id);
        data = p.data;
        hint = p.bpmHint ?? hint;
      } else throw new Error('Нужен трек с превью или свой файл');
      const t0 = performance.now();
      const { features: f, tempo } = await analyzeAudio(await decodeAudio(data), { bpmHint: hint, year: ref.year });
      console.info(`[lab] анализ за ${Math.round(performance.now() - t0)} мс`, f);
      setRows((r) => [
        {
          song: `${ref.artist} — ${ref.title}`, detected: Math.round(tempo.detected * 10) / 10, hint: tempo.hint,
          chosen: f.bpm, reason: tempo.reason, key: keyRu(f.key, f.mode), offset: f.beatOffset, rms: f.rmsMean, bright: f.brightness,
        },
        ...r,
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <Link to="/lab" className="mono">← лаборатория</Link>
        <h1>Темп и тональность</h1>
      </header>
      <p className="mono dim">Проверка темпа: возьмите медленную (~70 BPM) и быструю (~128 BPM) песню.</p>
      <SongPicker onChange={onSong} />
      <p>
        <button className="btn primary" disabled={!song || busy} onClick={() => void run()}>
          {busy ? 'Слушаю…' : 'Анализировать'}
        </button>
      </p>
      {error && <p className="error">{error}</p>}
      {rows.length > 0 && (
        <table className="mono small lab-table">
          <thead>
            <tr><th>песня</th><th>детектор</th><th>Deezer</th><th>итог</th><th>почему</th><th>тональность</th><th>доля</th><th>RMS</th><th>яркость</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.song}</td><td>{r.detected}</td><td>{r.hint ?? '—'}</td><td><b>{r.chosen}</b></td><td>{r.reason}</td>
                <td>{r.key}</td><td>{r.offset.toFixed(2)} с</td><td>{r.rms}</td><td>{r.bright}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
