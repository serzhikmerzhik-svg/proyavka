import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteDay, getDay, updateDay } from '../storage/db';
import { importDemoDays } from '../storage/demo';
import { DayInsights } from '../ui/DayInsights';
import { downloadDayZip } from '../storage/zip';
import { PrintScene, exportPrintPng } from '../render/printScene';
import {
  computeLayout,
  computeSlideLayout,
  dateStamp,
  drawPrint,
  drawSlideFrame,
  ensureFonts,
  renderThumb,
  type PrintLayout,
  type SlideLayout,
} from '../render/compositor';
import { slideTimeline, slideshowSeconds } from '../render/slides';
import { DevelopRecorder } from '../render/recorder';
import { SongPlayer, beatAt, rmsAt } from '../audio/player';
import {
  addVoiceToDay,
  browserVoiceSupported,
  ensureBrowserVoices,
  onVoice,
  pickBrowserVoice,
  speakInBrowser,
  type BrowserSpeech,
} from '../audio/voice';
import { ON_DEVICE_VOICE_NAME, isOnDeviceVoice, onDeviceRate } from '../audio/piper';
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

/** ИИ-оживление деталей скрыто из интерфейса по решению команды; код и сервер остаются. */
const SHOW_AI_MOTION = false;

/** Два способа проявить один и тот же день: отпечаток на столе или слайд-шоу 9:16. */
type View = 'print' | 'slides';
const VIEW_KEY = 'proyavka:view';
const loadView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'slides' ? 'slides' : 'print';
  } catch {
    return 'print';
  }
};
type Box = { left: number; top: number; width: number; height: number };

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
  const [backRect, setBackRect] = useState<Box | null>(null);
  const [view, setView] = useState<View>(loadView);
  const [musicFail, setMusicFail] = useState(false);
  // «Разбор дня» открыт сразу, если экран широкий и панель не закроет отпечаток
  const [insightsOpen, setInsightsOpen] = useState(() => window.innerWidth >= 1200);

  const viewRef = useRef<View>(view);
  const resizeRef = useRef<() => void>(() => {});
  const slideRectRef = useRef<SlideLayout | null>(null);
  const browserVoiceRef = useRef(false);
  const speechRef = useRef<BrowserSpeech | null>(null);
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
    getDay(id).then(async (found) => {
      let d = found;
      // прямая ссылка на демо-день (например, из описания для жюри): демо-дни подгружаются сами
      if (!d && id.startsWith('demo-')) {
        try {
          await importDemoDays();
          d = await getDay(id);
        } catch {
          // нет сети — покажем «такого дня нет»
        }
      }
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
    const fresh = await getDay(dayId);
    if (!fresh || voicePlayedRef.current) return;
    if (!fresh.voice) {
      // у сервера нет ключа — голос браузера по тем же правилам (в запись видео он не попадает)
      if (!browserVoiceRef.current) return;
      await ensureBrowserVoices();
      if (voicePlayedRef.current || phaseRef.current !== 'live' || playerRef.current !== player) return;
      const speech = speakInBrowser(fresh.text, recipeRef.current ?? fresh.recipe);
      if (!speech) return;
      voicePlayedRef.current = true;
      speechRef.current = speech;
      player.duck(true);
      setVoiceNote(`озвучка: ${speech.voiceName} · синтезированный голос браузера`);
      void speech.done.then(() => {
        if (playerRef.current === player) player.duck(false);
      });
      return;
    }
    voicePlayedRef.current = true;
    // голос с устройства нейтрален — темп по атмосфере: тихий день медленнее и ниже, яркий живее
    const onDevice = isOnDeviceVoice(fresh.voice);
    const rate = onDevice ? onDeviceRate((recipeRef.current ?? fresh.recipe).atmosphere.energy) : 1;
    if (onDevice) setVoiceNote(`озвучка: ${ON_DEVICE_VOICE_NAME} · синтезированный голос`);
    const seconds = await player.playVoice(fresh.voice, rate);
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
    let slideLayout: SlideLayout | null = null;
    const par = { x: 0, y: 0 };
    let airTime = 0;
    let lastNow = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(dpr, 2048 / Math.max(stage.clientWidth, stage.clientHeight, 1));
      canvas.width = Math.round(stage.clientWidth * scale);
      canvas.height = Math.round(stage.clientHeight * scale);
      layout = computeLayout(canvas.width, canvas.height);
      // верхняя панель лежит поверх сцены — кадр 9:16 ставим под неё
      const bar = stage.parentElement?.querySelector('.topbar')?.getBoundingClientRect();
      const topCss = bar ? Math.max(0, Math.min(bar.bottom - stage.getBoundingClientRect().top, stage.clientHeight * 0.25)) : 0;
      slideLayout = computeSlideLayout(canvas.width, canvas.height, 0.035, topCss * scale);
      slideRectRef.current = slideLayout;
      // окно сцены — под текущий режим; оборот карточки — поверх отпечатка или кадра 9:16
      if (viewRef.current === 'slides') {
        scene?.resize(slideLayout.w, slideLayout.h);
        const s = computeSlideLayout(stage.clientWidth, stage.clientHeight, 0.035, topCss);
        setBackRect({ left: s.x, top: s.y, width: s.w, height: s.h });
      } else {
        scene?.resize(layout.photoW, layout.photoH);
        const p = computeLayout(stage.clientWidth, stage.clientHeight);
        setBackRect({ left: p.printX, top: p.printY, width: p.printW, height: p.printH });
      }
    };
    resizeRef.current = resize;
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
      // в слайд-шоу проявляется первый кадр (два такта), дальше кадры идут под ритм
      const tl = viewRef.current === 'slides' && slideLayout ? slideTimeline(recipe) : null;
      const devDur = tl ? tl.intro : recipe.rhythm.developBars * music.barSeconds;
      const develop = clock ? Math.min(1, t / devDur) : 0;
      const beat = clock && !reduced ? beatAt(t, music) : { pulse: 0, index: 0 };
      const rms = clock ? rmsAt(t, music, loopSecRef.current) : 0.5;
      if (!reduced) {
        par.x += (tiltRef.current.x - par.x) * 0.08;
        par.y += (tiltRef.current.y - par.y) * 0.08;
        airTime += dt * (0.6 + 0.8 * rms); // частицы быстрее, когда громче
      }

      const sceneFrame = {
        t, time: now / 1000, develop, beat: beat.pulse, seed: beat.index, rms,
        parallax: (reduced ? [0, 0] : [-par.x * PARALLAX, par.y * PARALLAX]) as [number, number], airTime, reduced,
      };
      // красный фонарь пульсирует на долях и гаснет к концу проявки
      const safelight = clock ? (1 - smooth(0.7, 1, develop)) * (0.7 + 0.3 * beat.pulse) : 0.75;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let win: HTMLCanvasElement;
      if (tl && slideLayout) {
        const s = scene.drawSlides(sceneFrame, tl);
        win = s.win;
        drawSlideFrame(ctx, slideLayout, win, {
          caption: recipe.caption, date: day.date, title: recipe.folderName, develop, safelight,
          slide: s.slide, slides: s.slides, seg: s.seg,
          badge: scene.motionShown ? MOTION_LABEL : undefined,
        });
      } else {
        win = scene.draw(sceneFrame);
        drawPrint(ctx, layout, win, {
          caption: recipe.caption, date: day.date, develop, safelight,
          badge: scene.motionShown ? MOTION_LABEL : undefined,
        });
      }
      if (glowRef.current) glowRef.current.style.opacity = String(safelight * 0.55);

      const rec = recorderRef.current;
      if (rec) {
        rec.rec.draw(canvas, tl && slideLayout ? slideLayout : undefined);
        if (t >= Math.min(rec.stopAt, MAX_RECORD_S)) void finishRecording();
      }

      if (develop >= 1 && phaseRef.current === 'developing') {
        setPhaseBoth('live');
        // отпечаток: ещё 4 такта живого снимка; слайд-шоу: весь круг кадров, 15–60 с (голос продлит)
        if (rec) rec.stopAt = tl ? slideshowSeconds(day.photos.length, tl) : t + 4 * music.barSeconds;
        void playVoice(day.id);
        if (!thumbDoneRef.current && !tl) {
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
      if (e.type === 'progress') {
        setVoiceNote(
          e.progress <= 0
            ? 'голос «Ирина»: готовлю на устройстве…'
            : e.progress < 1
              ? `голос «Ирина»: загрузка модели ${Math.round(e.progress * 100)}%`
              : 'голос «Ирина»: синтезирую…',
        );
        return;
      }
      if (e.type === 'ready') {
        setVoiceNote('озвучка готова · синтезированный голос');
        void playVoice(day.id);
      } else if (e.type === 'unavailable') {
        setVoiceNote(e.reason);
        // без ключа — голос браузера, если в системе есть русский голос
        if (browserVoiceSupported()) {
          void ensureBrowserVoices().then((voices) => {
            if (disposed || !pickBrowserVoice(voices, (recipeRef.current ?? day.recipe).atmosphere.energy)) return;
            browserVoiceRef.current = true;
            setVoiceNote('озвучка: голос браузера (у сервера нет ключа) · синтезированный голос');
            void playVoice(day.id);
          });
        }
      } else setVoiceNote(`озвучка не удалась: ${e.error}`);
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
      resizeRef.current = () => {};
      speechRef.current?.stop();
      speechRef.current = null;
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
      const msg = (e as Error).message;
      setMusicFail(true);
      // 404/405 — сервера нет вовсе (GitHub Pages): ритм остаётся, а песню можно открыть по ссылке
      setNotice(
        /\((404|405)\)/.test(msg)
          ? 'Без сервера превью песни не загрузить — проявляю в её темпе; саму песню можно открыть ♪'
          : `Музыка недоступна (${msg}) — проявляю без неё, в том же темпе`,
      );
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
      // слайд-шоу пишем только кадром 9:16, отпечаток — целиком со столом
      const rect = viewRef.current === 'slides' ? slideRectRef.current : null;
      const srcW = rect ? rect.w : canvas.width;
      const srcH = rect ? rect.h : canvas.height;
      const k = Math.min(1, 1920 / Math.max(srcW, srcH)); // видео не больше 1920 по длинной стороне
      const rec = new DevelopRecorder(srcW * k, srcH * k, player.recordingTrack());
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
    speechRef.current?.stop();
    speechRef.current = null;
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

  /** Тот же день другим способом: окно сцены перестраивается, проявка начинается заново (если шла). */
  function switchView(v: View) {
    if (v === viewRef.current) return;
    viewRef.current = v;
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // приватный режим — выбор просто не запомнится
    }
    resizeRef.current();
    const wasPlaying = phaseRef.current !== 'idle';
    redevelop();
    if (wasPlaying) void startDevelop();
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
          <button
            type="button"
            className="insights-toggle"
            aria-pressed={insightsOpen}
            onClick={() => setInsightsOpen((v) => !v)}
          >
            ✦ Разбор
          </button>
          <div className="view-switch" role="radiogroup" aria-label="Как проявить день">
            {(['print', 'slides'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => switchView(v)}>
                {v === 'print' ? 'Отпечаток' : 'Слайд-шоу'}
              </button>
            ))}
          </div>
          <span className="mono dim">{day.folderName}</span>
          <ThemePicker />
        </div>
      </header>

      <div
        ref={stageRef}
        className="stage"
        onClick={onStageTap}
        style={{ '--day-a': r.palette[0], '--day-b': r.palette[1] ?? r.palette[0], '--day-c': r.palette[2] ?? r.palette[0] } as CSSProperties}
      >
        {insightsOpen && <DayInsights day={day} recipe={r} onClose={() => setInsightsOpen(false)} />}
        <div ref={glowRef} className="safelight-glow" />
        <div className={`card${flipped ? ' flipped' : ''}`}>
          <canvas ref={canvasRef} className="face front" />
          {backRect && (
            <div className="face back" style={backRect}>
              <p className="caveat back-caption">«{r.caption}»</p>
              <div className="lab-stamp mono">
                <div className="stamp-title">{r.folderName}</div>
                <div>{dateStamp(day.date)} · {r.process.map((p) => `${PROCESS_NAMES[p.id]} ${Math.round(p.weight * 100)}%`).join(' / ')}</div>
              </div>
              <p className="mono small">
                ♪{' '}
                {day.song.link ? (
                  <a href={day.song.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    {day.song.artist} — {day.song.title}
                  </a>
                ) : (
                  `${day.song.artist} — ${day.song.title}`
                )}
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
        {phase === 'live' && !flipped && (
          // в слайд-шоу внизу подпись и дата — подсказка уходит наверх
          <div className={`hint subtle mono${view === 'slides' ? ' high' : ''}`}>коснитесь — оборот</div>
        )}
      </div>

      <footer className="develop-bar">
        {notice && <span className="mono small notice bar-note">{notice}</span>}
        {musicFail && day.song.link && (
          <a className="btn small" href={day.song.link} target="_blank" rel="noreferrer">
            ♪ Открыть песню
          </a>
        )}
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
            {recording ? '● Запись…' : view === 'slides' ? 'Записать видео 9:16' : 'Записать видео'}
          </button>
        )}
        {memory && (
          <button className="btn ghost small" onClick={() => saveFile(memory, `${day.date} ${day.folderName}.webm`)}>
            Скачать видео
          </button>
        )}
        {SHOW_AI_MOTION && <button
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
        </button>}
        <button className="btn ghost small" onClick={() => void downloadFolder()} disabled={zipping}>
          {zipping ? 'Собираю…' : 'Скачать папку'}
        </button>
        <button className="btn ghost small" onClick={() => void remove()}>Удалить</button>
      </footer>
    </main>
  );
}
