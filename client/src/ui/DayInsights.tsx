/**
 * «Разбор дня» — объяснимая логика рецепта на одной стеклянной панели: оси настроения, доли процессов,
 * ритм от песни, свет, воздух, палитра из фото и «почему так». Это те же числа, что ведут шейдер;
 * ползунки настроения меняют их на лету.
 */
import { keyRu } from '../analysis/key';
import { PROCESS_NAMES } from '../recipe/presets';
import type { Day, Recipe } from '../recipe/types';

const AIR_RU: Record<string, string> = {
  steam: 'пар', leaves: 'листья', snow: 'снег', rain: 'дождь', dust: 'пылинки в свете', fog: 'туман',
};
const TIME_RU: Record<string, string> = {
  morning: 'утро', day: 'день', golden_hour: 'золотой час', evening: 'вечер', night: 'ночь', unknown: 'время не ясно',
};
const COMPOSITION_RU: Record<Recipe['composition'], string> = {
  single: 'один кадр', diptych: 'диптих', sequence: 'последовательность', strip: 'плёночная полоса', contact_sheet: 'контактный лист',
};
const holdRu = (bars: number) => (bars >= 1 ? 'такт' : bars >= 0.5 ? 'полтакта' : 'четверть такта');
const pct = (v: number) => Math.round(v * 100);

function Meter({ label, left, right, value }: { label: string; left: string; right: string; value: number }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="mono">{pct(value)}</span>
      </div>
      <div className="meter-track">
        <i style={{ width: `${pct(value)}%` }} />
      </div>
      <div className="meter-ends mono">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

export function DayInsights({ day, recipe: r, onClose }: { day: Day; recipe: Recipe; onClose: () => void }) {
  const m = r.music;
  const key = m.source === 'audio' ? keyRu(m.key, m.mode) : m.mode === 'major' ? 'мажор' : 'минор';
  const warmth = r.light.warmth > 0.15 ? 'тёплый свет' : r.light.warmth < -0.1 ? 'холодный свет' : 'нейтральный свет';
  return (
    // клик по панели не переворачивает отпечаток
    <aside className="insights" aria-label="Разбор дня" onClick={(e) => e.stopPropagation()}>
      <header className="insights-head">
        <span className="insights-title">✦ Разбор дня</span>
        <button type="button" className="insights-close" aria-label="Скрыть разбор" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="insights-folder">{r.folderName}</p>

      <section>
        <h3 className="mono">атмосфера · слова + песня</h3>
        <Meter label="Энергия" left="тише" right="ярче" value={r.atmosphere.energy} />
        <Meter label="Тон" left="тяжелее" right="светлее" value={r.atmosphere.tone} />
      </section>

      <section>
        <h3 className="mono">процесс · два ближайших из девяти</h3>
        {r.process.map((p) => (
          <div key={p.id} className="meter">
            <div className="meter-head">
              <span>{PROCESS_NAMES[p.id]}</span>
              <span className="mono">{pct(p.weight)}%</span>
            </div>
            <div className="meter-track">
              <i style={{ width: `${pct(p.weight)}%` }} />
            </div>
          </div>
        ))}
      </section>

      <section className="insights-grid">
        <div>
          <h3 className="mono">ритм</h3>
          <p>{Math.round(m.bpm)} BPM · {key}</p>
          <p className="dim">
            кадр — {holdRu(r.rhythm.frameHoldBars)}, проявка — {r.rhythm.developBars} такта,{' '}
            {r.rhythm.transition === 'cut' ? 'склейки' : 'наплывы'}
          </p>
        </div>
        <div>
          <h3 className="mono">свет</h3>
          <p>{TIME_RU[r.light.time] ?? r.light.time}</p>
          <p className="dim">{warmth}</p>
        </div>
        <div>
          <h3 className="mono">композиция</h3>
          <p>{COMPOSITION_RU[r.composition]}</p>
          <p className="dim">кадров: {day.photos.length}</p>
        </div>
        <div>
          <h3 className="mono">воздух</h3>
          <p>{r.air.particles.length ? r.air.particles.map((a) => AIR_RU[a] ?? a).join(', ') : 'чистый'}</p>
        </div>
      </section>

      <section>
        <h3 className="mono">палитра · из фото</h3>
        <div className="swatches">
          {r.palette.map((c) => (
            <i key={c} style={{ background: c }} title={c} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mono">почему так</h3>
        <ul className="insights-why">
          {r.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
