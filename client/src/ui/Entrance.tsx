/**
 * Главный вход — «кинопроектор»: вращается катушка, из неё идёт лента, кадры проявляются на ходу,
 * мерцает луч. В кадрах — отпечатки из архива (если их пока нет — цветные заглушки).
 */
import { Link } from 'react-router-dom';
import { ThemePicker } from './theme';

const PLACEHOLDERS = ['#e48b4a', '#3d6f9a', '#c9a46c', '#7a3a5a', '#4f7a4a', '#e2573b', '#5c6874', '#f0b43a'];

type Props = { frames: (string | undefined)[]; dayCount: number };

const sessionNo = () => {
  const [y, m, d] = new Date().toLocaleDateString('sv-SE').split('-');
  return `${y.slice(2)}·${m}·${d}`;
};

function Reel() {
  return (
    <svg className="reel" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="96" className="reel-rim" />
      <circle cx="100" cy="100" r="84" className="reel-disc" />
      {[0, 72, 144, 216, 288].map((a) => (
        <circle
          key={a}
          cx={100 + 52 * Math.cos(((a - 90) * Math.PI) / 180)}
          cy={100 + 52 * Math.sin(((a - 90) * Math.PI) / 180)}
          r="22"
          className="reel-hole"
        />
      ))}
      <circle cx="100" cy="100" r="16" className="reel-hub" />
      <circle cx="100" cy="100" r="5" className="reel-hole" />
    </svg>
  );
}

export function Entrance({ frames, dayCount }: Props) {
  // лента вдвое длиннее экрана — бесшовная прокрутка
  const cells = Array.from({ length: 10 }, (_, i) => frames[i % Math.max(1, frames.length)]);
  const strip = [...cells, ...cells];
  return (
    <section className="entrance" aria-label="Проявка — главный вход">
      <div className="entrance-top">
        <span className="entrance-session mono">сеанс № {sessionNo()}</span>
        <ThemePicker />
      </div>

      <div className="beam" aria-hidden="true" />
      <Reel />

      <div className="film" aria-hidden="true">
        <div className="film-run">
          {strip.map((url, i) => (
            <div className="film-frame" key={i} style={{ animationDelay: `${(i % 10) * 0.45}s` }}>
              {url ? <img src={url} alt="" /> : <span style={{ background: PLACEHOLDERS[i % PLACEHOLDERS.length] }} />}
            </div>
          ))}
        </div>
      </div>

      <div className="entrance-copy">
        <h1 className="entrance-title">Проявка</h1>
        <p className="entrance-tagline">Цвет — из фото, свет — из слов, ритм — из песни.</p>
        <div className="entrance-actions">
          <Link to="/new" className="btn primary big">
            <span className="stub">билет</span>Проявить день
          </Link>
          <a href="#archive" className="btn big">
            <span className="stub">{dayCount}</span>Контактный лист
          </a>
          <Link to="/lab" className="btn ghost">Лаборатория</Link>
        </div>
      </div>

      <a href="#archive" className="entrance-scroll mono" aria-label="К контактному листу">
        к архиву <i aria-hidden="true">↓</i>
      </a>
    </section>
  );
}
