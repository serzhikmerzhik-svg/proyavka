import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteDay, getDay, updateDay } from '../storage/db';
import { downloadDayZip } from '../storage/zip';
import { PrintScene, exportPrintPng } from '../render/printScene';
import { computeLayout, dateStamp, drawPrint, ensureFonts, renderThumb, type PrintLayout } from '../render/compositor';
import { DevelopRecorder } from '../render/recorder';
import { SongPlayer, beatAt, rmsAt } from '../audio/player';
import { addVoiceToDay, onVoice } from '../audio/voice';
import { envelopeFromBuffer, fetchPreview } from '../analysis/audioFeatures';
import { addDepthToDay, onDepth } from '../analysis/depth';
import { keyRu } from '../analysis/key';
import { buildRecipe } from '../recipe/buildRecipe';
import { PROCESS_NAMES } from '../recipe/presets';
import { ThemePicker } from '../ui/theme';
import {
  MOTION_LABEL,
  STAGE_RU,
  animateDay,
  motionAvailability,
  motionProgress,
  onMotion,
  providerName,
  type MotionAvailability,
  type MotionInfo,
  type MotionProgress,
} from '../ai/motion';
import type { Day, Recipe } from '../recipe/types';

type Phase = 'idle' | 'loading' | 'developing' | 'live';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** наибольший сдвиг параллакса в долях кадра (×0,5 от глубины; запас зума в шейдере — 3%) */
const PARALLAX = 0.03;
/** запись проявки: не дольше минуты */
const MAX_RECORD_S = 60;

type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Почему оживление недоступно — без повтора «ИИ-оживление», если сервер уже так сказал. */
const motionOff = (reason: string) => (reason.startsWith(MOTION_LABEL) ? reason : `${MOTION_LABEL} недоступно: ${reason}`);

const elapsed = (since: number) => {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function Develop() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [day, setDay] = useState<Day | null | undefined>(undefined);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [mood, setMood] = useState({ energy: 0.5, tone: 0.5 });
  const [phase, setPhase] = useState<Phase>('idle');
  const [flipped, setFlipped] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [depthNote, setDepthNote] = useState<string>();
  const [voiceNote, setVoiceNote] = useState<string>();
  const [zipping, setZipping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [memory, setMemory] = useState<Blob | null>(null);
  const [motion, setMotion] = useState<MotionInfo | null>(null);
  const [motionProg, setMotionProg] = useState<MotionProgress | null>(null);
  const [motionAvail, setMotionAvail] = useState<MotionAvailability | null>(null);
  const [, setTick] = useState(0); // секундомер оживления
  const [cssLayout, setCssLayout] = useState<PrintLayout | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SongPlayer | null>(null);
  const loopSecRef = useRef<number | undefined>(undefined);
  const recipeRef = useRef<Recipe | null>(null);
  const sceneRef = useRef<PrintScene | null>(null);
  const recorderRef = useRef<{ rec: DevelopRecorder; stopAt: number } | null>(null);
  const thumbDoneRef = useRef(false);
  const voicePlayedRef = useRef(false);
  const gyroAskedRef = useRef(false);
  const tiltRef = useRef({ x: 0, y: 0 }); // цель параллакса −1..1 (курсор или гироскоп)
  const phaseRef = useRef<Phase>('idle');
  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  useEffect(() => {
    let alive = true;
    getDay(id).then((d) => {
      if (!alive) return;
      setDay(d ?? null);
      if (d) {
        recipeRef.current = d.recipe;
        thumbDoneRef.current = Boolean(d.printThumb);
        setRecipe(d.recipe);
        setMood({ energy: d.recipe.atmosphere.energy, tone: d.recipe.atmosphere.tone });
        setMemory(d.memory ?? null);
        setMotion(d.motion ?? null);
        setMotionProg(motionProgress(d.id) ?? null);
      }
    });
    motionAvailability().then((a) => alive && setMotionAvail(a));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!motionProg) return;
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, [motionProg]);

  /** Озвучка звучит, когда снимок проявился; если mp3 ещё синтезируется — как только будет готов. */
  async function playVoice(dayId: string) {
    const player = playerRef.current;
    if (!player || voicePlayedRef.current || phaseRef.current !== 'live') return;
    const voice = (await getDay(dayId))?.voice;
    if (!voice || voicePlayedRef.current) return;
    voicePlayedRef.current = true;
    const seconds = await player.playVoice(voice);
    const r = recorderRef.current;
    if (r) r.stopAt = Math.max(r.stopAt, player.now() + seconds + 1);
  }

  // Рендер-цикл: сцена (композиция → шейдер) → окно снимка → компоновщик (рамка, штамп, подпись)
  useEffect(() => {
    if (!day) return;
    const stage = stageRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const music = day.recipe.music;
    const reduced = reducedMotion();
    let disposed = false;
    let raf = 0;
    let scene: PrintScene | null = null;
    let layout: PrintLayout | null = null;
    const par = { x: 0, y: 0 };
    let airTime = 0;
    let lastNow = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(dpr, 2048 / Math.max(stage.clientWidth, stage.clientHeight, 1));
      canvas.width = Math.round(stage.clientWidth * scale);
      canvas.height = Math.round(stage.clientHeight * scale);
      layout = computeLayout(canvas.width, canvas.height);
      scene?.resize(layout.photoW, layout.photoH);
      setCssLayout(computeLayout(stage.clientWidth, stage.clientHeight));
    };
    const ro = new ResizeObserver(resize);

    // параллакс: курсор над отпечатком или наклон телефона
    const onPointer = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      tiltRef.current = { x: clamp1(((e.clientX - r.left) / r.width - 0.5) * 2), y: clamp1(((e.clientY - r.top) / r.height - 0.5) * 2) };
    };
    const onLeave = () => {
      tiltRef.current = { x: 0, y: 0 };
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      tiltRef.current = { x: clamp1(e.gamma / 30), y: clamp1((e.beta - 45) / 30) };
    };
    stage.addEventListener('pointermove', onPointer);
    stage.addEventListener('pointerleave', onLeave);
    window.addEventListener('deviceorientation', onOrient);

    const finishRecording = async () => {
      const r = recorderRef.current;
      if (!r) return;
      recorderRef.current = null;
      r.rec.stop();
      const blob = await r.rec.done;
      setRecording(false);
      if (!blob.size) return;
      await updateDay(day.id, { memory: blob });
      setMemory(blob);
      setNotice(`Видео проявки сохранено (${(blob.size / 1e6).toFixed(1)} МБ) — попадёт в папку дня как memory.webm`);
    };

    const frame = () => {
      const recipe = recipeRef.current;
      if (disposed || !scene || !layout || !recipe) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      const clock = playerRef.current && phaseRef.current !== 'idle' && phaseRef.current !== 'loading' ? playerRef.current : null;
      const t = clock ? clock.now() : 0;
      const devDur = recipe.rhythm.developBars * music.barSeconds;
      const develop = clock ? Math.min(1, t / devDur) : 0;
      const beat = clock && !reduced ? beatAt(t, music) : { pulse: 0, index: 0 };
      const rms = clock ? rmsAt(t, music, loopSecRef.current) : 0.5;
      if (!reduced) {
        par.x += (tiltRef.current.x - par.x) * 0.08;
        par.y += (tiltRef.current.y - par.y) * 0.08;
        airTime += dt * (0.6 + 0.8 * rms); // частицы быстрее, когда громче
      }

      const win = scene.draw({
        t, time: now / 1000, develop, beat: beat.pulse, seed: beat.index, rms,
        parallax: reduced ? [0, 0] : [-par.x * PARALLAX, par.y * PARALLAX], airTime, reduced,
      });

      // красный фонарь пульсирует на долях и гаснет к концу проявки
      const safelight = clock ? (1 - smooth(0.7, 1, develop)) * (0.7 + 0.3 * beat.pulse) : 0.75;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawPrint(ctx, layout, win, {
        caption: recipe.caption, date: day.date, develop, safelight,
        badge: scene.motionShown ? MOTION_LABEL : undefined,
      });
      if (glowRef.current) glowRef.current.style.opacity = String(safelight * 0.55);

      const rec = recorderRef.current;
      if (rec) {
        rec.rec.draw(canvas);
        if (t >= Math.min(rec.stopAt, MAX_RECORD_S)) void finishRecording();
      }

      if (develop >= 1 && phaseRef.current === 'developing') {
        setPhaseBoth('live');
        if (rec) rec.stopAt = t + 4 * music.barSeconds; // ещё 4 такта живого снимка (голос продлит)
        void playVoice(day.id);
        if (!thumbDoneRef.current) {
          thumbDoneRef.current = true;
          // окно уже отрисовано полностью проявленным — снимаем миниатюру для архива
          renderThumb(win, recipe.caption, day.date)
            .then((blob) => updateDay(day.id, { printThumb: blob }))
            .catch((e) => console.warn(e));
        }
      }
      raf = requestAnimationFrame(frame);
    };

    // глубина и озвучка досчитываются в фоне и подхватываются по мере готовности
    const offDepth = onDepth(async (e) => {
      if (e.type === 'progress') setDepthNote(`глубина: загрузка модели ${Math.round(e.progress)}%`);
      else if (e.type === 'error' && e.dayId === day.id) setDepthNote(`глубина недоступна: ${e.error}`);
      else if (e.type === 'photo' && e.dayId === day.id) {
        const fresh = await getDay(day.id);
        const blob = fresh?.photos[e.index]?.depth;
        if (blob && scene) await scene.setDepth(e.index, blob);
        setDepthNote(`глубина: кадр ${e.index + 1} готов (${e.device === 'webgpu' ? 'WebGPU' : 'WASM'}, ${e.ms} мс)`);
      }
    });
    const offVoice = onVoice((e) => {
      if (e.dayId !== day.id) return;
      if (e.type === 'ready') {
        setVoiceNote('озвучка готова · синтезированный голос');
        void playVoice(day.id);
      } else if (e.type === 'unavailable') setVoiceNote(e.reason);
      else setVoiceNote(`озвучка не удалась: ${e.error}`);
    });
    // ИИ-оживление генерируется минутами — готовое видео подхватываем на лету
    const offMotion = onMotion(async (e) => {
      if (e.dayId !== day.id) return;
      if (e.type === 'progress') {
        setMotionProg(e);
        return;
      }
      setMotionProg(null);
      if (e.type === 'error') {
        setNotice(`ИИ-оживление не удалось: ${e.error}`);
        return;
      }
      const fresh = (await getDay(day.id))?.motion;
      if (!fresh || disposed) return;
      try {
        await sceneRef.current?.setMotion(fresh.blob, fresh.photoIndex);
        setMotion(fresh);
        setNotice(
          phaseRef.current === 'live'
            ? `Детали ожили · ${MOTION_LABEL}`
            : `Детали ожили — видно, когда снимок проявится. На отпечатке пометка «${MOTION_LABEL}»`,
        );
      } catch (err) {
        setNotice(`ИИ-оживление не открылось: ${(err as Error).message}`);
      }
    });

    (async () => {
      await ensureFonts();
      const s = await PrintScene.create(day, recipeRef.current ?? day.recipe);
      if (disposed) {
        s.dispose();
        return;
      }
      scene = s;
      sceneRef.current = s;
      if (day.motion) {
        await s.setMotion(day.motion.blob, day.motion.photoIndex).catch((e) =>
          setNotice(`ИИ-оживление не открылось: ${(e as Error).message}`),
        );
        if (disposed) return;
      }
      ro.observe(stage);
      resize();
      raf = requestAnimationFrame(frame);
      if (day.photos.some((p) => !p.depth)) {
        setDepthNote('глубина: считаю…');
        void addDepthToDay(day.id);
      }
      if (!day.voice) void addVoiceToDay(day.id);
    })().catch((e) => setNotice(`Не удалось подготовить отпечаток: ${(e as Error).message}`));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      offDepth();
      offVoice();
      offMotion();
      stage.removeEventListener('pointermove', onPointer);
      stage.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('deviceorientation', onOrient);
      recorderRef.current?.rec.stop();
      recorderRef.current = null;
      scene?.dispose();
      sceneRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [day]);

  async function startDevelop(opts: { record?: boolean } = {}) {
    if (!day || phaseRef.current !== 'idle') return;
    // AudioContext создаём синхронно, внутри жеста пользователя
    const player = new SongPlayer();
    setPhaseBoth('loading');
    // без жеста (например, после долгого перетаскивания ползунка) браузер не даст звук
    await Promise.race([player.ctx.resume().catch(() => undefined), sleep(400)]);
    if (player.ctx.state !== 'running') {
      player.dispose();
      setNotice('Браузер не дал включить звук — коснитесь отпечатка, чтобы проявить');
      setPhaseBoth('idle');
      return;
    }
    const s = day.song;
    try {
      if (s.source === 'file' && day.audioFile) await player.load(day.audioFile);
      else if ((s.source === 'deezer' || s.source === 'itunes') && s.id) await player.load((await fetchPreview(s.source, s.id)).data);
    } catch (e) {
      setNotice(`Музыка недоступна (${(e as Error).message}) — проявляю без неё, в том же темпе`);
    }
    loopSecRef.current = player.buffer?.duration;
    // у дня нет огибающей RMS (демо-дни) — считаем её из буфера один раз и сохраняем
    if (player.buffer && !day.analysis.music.rmsEnvelope.length) {
      const env = envelopeFromBuffer(player.buffer);
      day.analysis.music.rmsEnvelope = env;
      const r = recipeRef.current;
      if (r) r.music.rmsEnvelope = env;
      void updateDay(day.id, { analysis: day.analysis, ...(r ? { recipe: r } : {}) });
    }
    playerRef.current = player;
    voicePlayedRef.current = false;
    if (opts.record) {
      const canvas = canvasRef.current!;
      const k = Math.min(1, 1920 / Math.max(canvas.width, canvas.height)); // видео не больше 1920 по длинной стороне
      const rec = new DevelopRecorder(canvas.width * k, canvas.height * k, player.recordingTrack());
      recorderRef.current = { rec, stopAt: Infinity }; // граница появится, когда снимок проявится
      setRecording(true);
      setNotice('● запись проявки…');
    }
    player.start();
    setPhaseBoth('developing');
  }

  function redevelop() {
    recorderRef.current?.rec.stop();
    recorderRef.current = null;
    setRecording(false);
    playerRef.current?.dispose();
    playerRef.current = null;
    loopSecRef.current = undefined;
    setFlipped(false);
    setNotice(undefined);
    setPhaseBoth('idle');
  }

  /** Поправка настроения: рецепт пересобирается с ручными осями, отпечаток проявляется заново. */
  function commitMood(next: { energy: number; tone: number }) {
    if (!day) return;
    const current = recipeRef.current ?? day.recipe;
    if (Math.abs(next.energy - current.atmosphere.energy) < 0.005 && Math.abs(next.tone - current.atmosphere.tone) < 0.005) return;
    const r = buildRecipe({
      text: day.text,
      date: day.date,
      analysis: day.analysis,
      music: day.analysis.music,
      photos: day.photos,
      overrides: next,
    });
    recipeRef.current = r;
    setRecipe(r);
    sceneRef.current?.setRecipe(r);
    thumbDoneRef.current = false; // отпечаток изменился — миниатюру архива снимем заново
    void updateDay(day.id, { recipe: r });
    redevelop();
    void startDevelop();
  }

  function onStageTap() {
    // iOS разрешает гироскоп только по жесту — спрашиваем при первом касании, до любых await
    const DOE = window.DeviceOrientationEvent as unknown as OrientationPermission | undefined;
    if (!gyroAskedRef.current && typeof DOE?.requestPermission === 'function') {
      gyroAskedRef.current = true;
      DOE.requestPermission().catch(() => 'denied');
    }
    if (phaseRef.current === 'idle') void startDevelop();
    else if (phaseRef.current === 'live') setFlipped((f) => !f);
  }

  function recordVideo() {
    redevelop();
    void startDevelop({ record: true });
  }

  /** ИИ-оживление: только по явному согласию; уже оживлённый день — кнопка убирает видео. */
  async function toggleMotion() {
    if (!day || motionProg) return;
    if (motion) {
      if (!confirm('Убрать ИИ-оживление? Видео удалится из дня, отпечаток снова станет неподвижным.')) return;
      await updateDay(day.id, { motion: undefined });
      await sceneRef.current?.setMotion(null);
      setMotion(null);
      setNotice(`${MOTION_LABEL} убрано`);
      return;
    }
    const avail = motionAvail?.enabled ? motionAvail : await motionAvailability();
    setMotionAvail(avail);
    if (!avail.enabled) {
      setNotice(`${motionOff(avail.reason)}. Чтобы включить: VIDEO_PROVIDER=kling и ключи Kling в .env сервера`);
      return;
    }
    const ok = confirm(
      `Оживить детали кадра дня с помощью ИИ (${providerName(avail.provider)})?\n\n` +
        'Кадр уйдёт во внешний видео-сервис; генерация займёт 1–5 минут и расходует кредиты сервиса. ' +
        'Камера останется неподвижной — шевельнутся только детали. ' +
        `Результат будет помечен «${MOTION_LABEL}».`,
    );
    if (!ok) return;
    setNotice(undefined);
    void animateDay(day.id);
  }

  async function downloadFolder() {
    if (!day) return;
    setZipping(true);
    try {
      const fresh = (await getDay(day.id)) ?? day; // с картами глубины, озвучкой и видео, если готовы
      const r = recipeRef.current ?? fresh.recipe;
      const printPng = await exportPrintPng(fresh, r);
      await downloadDayZip({ ...fresh, recipe: r }, { printPng });
    } catch (e) {
      setNotice(`Папку собрать не удалось: ${(e as Error).message}`);
    } finally {
      setZipping(false);
    }
  }

  async function remove() {
    if (!day || !confirm(`Удалить день «${day.folderName}»? Это нельзя отменить.`)) return;
    await deleteDay(day.id);
    navigate('/#archive');
  }

  if (day === undefined) return <main className="page develop" />;
  if (day === null) {
    return (
      <main className="page">
        <p className="mono">Такого дня нет в архиве.</p>
        <Link to="/#archive" className="mono">← контактный лист</Link>
      </main>
    );
  }

  const r = recipe ?? day.recipe;
  const m = r.music;
  const moodSlider = (axis: 'energy' | 'tone', left: string, right: string) => (
    <label className="mood-axis mono small">
      <span>{left}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={mood[axis]}
        aria-label={`${left} — ${right}`}
        onChange={(e) => setMood((v) => ({ ...v, [axis]: Number(e.target.value) }))}
        onPointerUp={(e) => commitMood({ ...mood, [axis]: Number(e.currentTarget.value) })}
        onKeyUp={(e) => commitMood({ ...mood, [axis]: Number(e.currentTarget.value) })}
      />
      <span>{right}</span>
    </label>
  );

  return (
    <main className="develop">
      <header className="topbar overlay">
        <Link to="/#archive" className="mono">← контактный лист</Link>
        <div className="topbar-actions">
          <span className="mono dim">{day.folderName}</span>
          <ThemePicker />
        </div>
      </header>

      <div ref={stageRef} className="stage" onClick={onStageTap}>
        <div ref={glowRef} className="safelight-glow" />
        <div className={`card${flipped ? ' flipped' : ''}`}>
          <canvas ref={canvasRef} className="face front" />
          {cssLayout && (
            <div
              className="face back"
              style={{ left: cssLayout.printX, top: cssLayout.printY, width: cssLayout.printW, height: cssLayout.printH }}
            >
              <p className="caveat back-caption">«{r.caption}»</p>
              <div className="lab-stamp mono">
                <div className="stamp-title">{r.folderName}</div>
                <div>{dateStamp(day.date)} · {r.process.map((p) => `${PROCESS_NAMES[p.id]} ${Math.round(p.weight * 100)}%`).join(' / ')}</div>
              </div>
              <p className="mono small">
                ♪ {day.song.artist} — {day.song.title}
                <br />
                {Math.round(m.bpm)} BPM · {m.source === 'audio' ? keyRu(m.key, m.mode) : m.mode === 'major' ? 'мажор' : 'минор'}
              </p>
              {motion && (
                <p className="mono small">
                  ✦ {MOTION_LABEL}: кадр {motion.photoIndex + 1}, {providerName(motion.provider)} {motion.model}
                </p>
              )}
              <p className="mono small dim">атмосфера по словам дня</p>
              <ul className="why">
                {r.why.map((w) => (
                  <li key={w} className="caveat">{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {phase === 'idle' && <div className="hint mono">Коснитесь, чтобы проявить</div>}
        {phase === 'loading' && <div className="hint mono">Заряжаю звук…</div>}
        {phase === 'live' && !flipped && <div className="hint subtle mono">коснитесь — оборот</div>}
      </div>

      <footer className="develop-bar">
        {notice && <span className="mono small notice bar-note">{notice}</span>}
        <div className="mood" title="Поправить настроение — отпечаток проявится заново">
          {moodSlider('energy', 'тише', 'ярче')}
          {moodSlider('tone', 'тяжелее', 'светлее')}
        </div>
        {(depthNote || voiceNote) && (
          <span className="mono small dim bar-note">{[depthNote, voiceNote].filter(Boolean).join(' · ')}</span>
        )}
        <button className="btn ghost small" onClick={redevelop} disabled={phase === 'idle' || phase === 'loading'}>
          Проявить заново
        </button>
        {DevelopRecorder.supported() && (
          <button className="btn ghost small" onClick={recordVideo} disabled={recording}>
            {recording ? '● Запись…' : 'Записать видео'}
          </button>
        )}
        {memory && (
          <button className="btn ghost small" onClick={() => saveFile(memory, `${day.date} ${day.folderName}.webm`)}>
            Скачать видео
          </button>
        )}
        <button
          className={`btn small${motion ? ' ghost' : ' ai'}`}
          onClick={() => void toggleMotion()}
          disabled={Boolean(motionProg)}
          aria-live="polite"
          title={
            motionAvail && !motionAvail.enabled
              ? motionOff(motionAvail.reason)
              : 'Нейросеть едва оживит детали кадра — пар, листья, свет; камера неподвижна'
          }
        >
          {motionProg
            ? `✦ ${STAGE_RU[motionProg.stage]} ${elapsed(motionProg.startedAt)}`
            : motion
              ? '✦ Убрать оживление'
              : '✦ Оживить детали'}
        </button>
        <button className="btn ghost small" onClick={() => void downloadFolder()} disabled={zipping}>
          {zipping ? 'Собираю…' : 'Скачать папку'}
        </button>
        <button className="btn ghost small" onClick={() => void remove()}>Удалить</button>
      </footer>
    </main>
  );
}
