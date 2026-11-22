import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Entrance } from '../ui/Entrance';
import { listDays } from '../storage/db';
import { PROCESS_NAMES } from '../recipe/presets';
import { useObjectUrls } from '../ui/useObjectUrls';
import { ThemePicker } from '../ui/theme';
import { importDemoDays, isDemoDay, removeDemoDays } from '../storage/demo';
import type { Day } from '../recipe/types';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function haystack(d: Day): string {
  const month = MONTHS[Number(d.date.slice(5, 7)) - 1] ?? '';
  return [d.folderName, d.text, d.date, month, d.song.artist, d.song.title, ...d.recipe.process.map((p) => PROCESS_NAMES[p.id])]
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/** Карточка дня: отпечаток, название папки, ритм, процессы и палитра — свечение карточки в цвет самого дня. */
function DayCard({ day, url }: { day: Day; url?: string }) {
  const r = day.recipe;
  return (
    <Link to={`/day/${day.id}`} className="contact" style={{ '--day-glow': r.palette[0] ?? 'var(--accent)' } as CSSProperties}>
      <span className="contact-media">
        {url ? <img src={url} alt={day.folderName} loading="lazy" /> : <span className="contact-blank" />}
        {day.motion && <span className="contact-badge mono">✦ ИИ</span>}
      </span>
      <span className="contact-body">
        <span className="contact-title">{day.folderName}</span>
        <span className="contact-meta mono">
          <span className="frame-no">{day.date.split('-').reverse().join('.')}</span> · {Math.round(r.music.bpm)} BPM
        </span>
        <span className="contact-chips">
          {r.process.map((p) => (
            <span key={p.id} className="chip mono">{PROCESS_NAMES[p.id]} {Math.round(p.weight * 100)}%</span>
          ))}
        </span>
        <span className="palette-bar" aria-hidden="true">
          {r.palette.map((c) => <i key={c} style={{ background: c }} />)}
        </span>
      </span>
    </Link>
  );
}

export default function Archive() {
  const [days, setDays] = useState<Day[] | null>(null);
  const [q, setQ] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string>();
  const [params] = useSearchParams();
  // ?today=YYYY-MM-DD — «сегодня» для блока «Год назад» (демо)
  const todayParam = params.get('today');
  const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : new Date().toLocaleDateString('sv-SE');

  const reload = () => listDays().then(setDays).catch(() => setDays([]));
  useEffect(() => {
    void reload();
  }, []);

  // «← контактный лист» с других экранов ведёт сразу к архиву, мимо главного входа
  const location = useLocation();
  useEffect(() => {
    if (location.hash === '#archive' && days !== null) document.getElementById('archive')?.scrollIntoView();
  }, [location.hash, days]);

  const hasDemo = (days ?? []).some(isDemoDay);
  async function toggleDemo() {
    setDemoBusy(true);
    setDemoError(undefined);
    try {
      if (hasDemo) await removeDemoDays();
      else await importDemoDays();
      await reload();
    } catch (e) {
      setDemoError(`Демо-дни не загрузились: ${(e as Error).message}`);
    } finally {
      setDemoBusy(false);
    }
  }

  // миниатюра: проявленный отпечаток, иначе первое фото
  const blobs = useMemo(
    () => (days ?? []).map((d) => d.printThumb ?? d.photos[d.recipe.bestPhotoIndex]?.blob ?? d.photos[0]?.blob),
    [days],
  );
  const urlList = useObjectUrls(blobs);
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    (days ?? []).forEach((d, i) => {
      const u = urlList[i];
      if (u) map.set(d.id, u);
    });
    return map;
  }, [days, urlList]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/ё/g, 'е');
    return (days ?? []).filter((d) => !needle || haystack(d).includes(needle));
  }, [days, q]);

  // тот же день и месяц в прошлые годы; ближайший год — первым
  const yearAgo = useMemo(() => {
    const [y, md] = [Number(today.slice(0, 4)), today.slice(5)];
    return (days ?? [])
      .filter((d) => d.date.slice(5) === md && Number(d.date.slice(0, 4)) < y)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((d) => ({ day: d, years: y - Number(d.date.slice(0, 4)) }));
  }, [days, today]);
  const yearsLabel = (n: number) => (n === 1 ? 'год назад' : n < 5 ? `${n} года назад` : `${n} лет назад`);

  return (
    <>
    <Entrance frames={(days ?? []).slice(0, 10).map((d) => urls.get(d.id))} dayCount={days?.length ?? 0} />
    <main className="page archive" id="archive">
      <header className="topbar">
        <h1>Контактный лист</h1>
        <div className="topbar-actions">
          <ThemePicker />
          <Link to="/new" className="btn primary">Экспонировать день</Link>
        </div>
      </header>

      {yearAgo.length > 0 && (
        <section className="year-ago">
          <h2 className="caveat">{yearAgo[0].years === 1 ? 'Год назад' : 'В этот день раньше'}</h2>
          <div className="sheet">
            {yearAgo.map(({ day: d, years }) => (
              <div key={d.id} className="year-ago-item">
                <DayCard day={d} url={urls.get(d.id)} />
                <span className="mono small dim">{yearsLabel(years)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <input
        className="search"
        type="search"
        placeholder="Поиск: слово, месяц, процесс…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <section className="lighttable">
        {days === null ? null : filtered.length === 0 ? (
          <div className="empty">
            <p className="mono dim">
              {days.length === 0 ? 'Контактный лист пуст. Экспонируйте первый день — или посмотрите демо-дни.' : 'Ничего не нашлось.'}
            </p>
            {days.length === 0 && (
              <button className="btn primary" onClick={() => void toggleDemo()} disabled={demoBusy}>
                {demoBusy ? 'Загружаю…' : 'Загрузить 5 демо-дней'}
              </button>
            )}
          </div>
        ) : (
          <div className="sheet">
            {filtered.map((d) => <DayCard key={d.id} day={d} url={urls.get(d.id)} />)}
          </div>
        )}
      </section>

      <footer className="archive-foot mono small">
        {(days?.length ?? 0) > 0 && (
          <button className="btn ghost small" onClick={() => void toggleDemo()} disabled={demoBusy}>
            {demoBusy ? '…' : hasDemo ? 'Убрать демо-дни' : 'Загрузить демо-дни'}
          </button>
        )}
        {demoError && <span className="error">{demoError}</span>}
        <Link to="/lab" className="dim">лаборатория</Link>
      </footer>
    </main>
    </>
  );
}
