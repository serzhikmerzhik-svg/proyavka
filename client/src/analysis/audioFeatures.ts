/**
 * Признаки музыки в браузере (SPEC §4.2): темп и первая доля, огибающая RMS, спектральный центроид,
 * средняя хрома → тональность. Работает с превью (30 с) или с файлом пользователя.
 */
import Meyda from 'meyda';
import { guess } from 'web-audio-beat-detector';
import { detectKey } from './key';
import { eraFromYear } from './music';
import type { MusicFeatures } from '../recipe/types';

const FRAME = 2048;
const HOP = 1024;
const CHROMA_FRAME = 8192; // при 2048 бин (21.5 Гц) шире полутона ниже ~400 Гц — хрома перекашивается
const ENV_RATE = 20; // значений огибающей в секунду
const BASS_HZ = 150;
/** порог «есть бочка»: на 16 превью ритм-секция давала ≥ 0.24, баллады ≤ 0.06, Radiohead — 0.19 */
const DRUMS_MIN = 0.22;

type MeydaLike = {
  bufferSize: number;
  sampleRate: number;
  extract: (features: string | string[], signal: Float32Array) => unknown;
};
const M = Meyda as unknown as MeydaLike;

export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  // OfflineAudioContext не требует жеста пользователя
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(data);
}

function mono(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

/** Нормированная автокорреляция огибающей на лаге одной доли данного темпа. */
function acfAtTempo(env: number[], rate: number, bpm: number): number {
  const mean = env.reduce((s, v) => s + v, 0) / env.length;
  const e = env.map((v) => v - mean);
  const lag = (rate * 60) / bpm;
  const l0 = Math.floor(lag);
  const fr = lag - l0;
  let s = 0;
  let n = 0;
  for (let i = 0; i + l0 + 1 < e.length; i++) {
    s += e[i] * (e[i + l0] * (1 - fr) + e[i + l0 + 1] * fr);
    n++;
  }
  const z = e.reduce((acc, v) => acc + v * v, 0) / e.length;
  return n && z ? s / n / z : 0;
}

export type TempoDecision = {
  detected: number;
  hint?: number;
  chosen: number;
  offset: number;
  drums: boolean;
  /** автокорреляция басовых атак на доле медленного и быстрого кандидата */
  bass: [lo: number, hi: number];
  reason: string;
};

type Guess = { bpm: number; offset: number };

/**
 * Выбор октавы темпа. Проверено на превью: детектор в диапазоне 60–180 делит пополам почти всю
 * танцевальную музыку (Summer 128 → 64), а BPM Deezer часто удваивает баллады (All of Me 63 → 126).
 * Поэтому решаем по басу:
 *  - есть «бочка» (басовая огибающая атак периодична) → темп из диапазона 90–180, октаву выбираем по
 *    автокорреляции баса на доле и на полудоле;
 *  - баса с ритмом нет (баллада) → диапазон 60–180, как в SPEC, — медленная песня не удваивается.
 * Deezer решает только неоднозначные случаи.
 */
export function decideTempo(g60: Guess, g90: Guess, bassAcf: (bpm: number) => number, hint?: number): TempoDecision {
  const lo = g90.bpm >= 120 ? g90.bpm / 2 : g90.bpm;
  const hi = lo * 2;
  const aLo = bassAcf(lo);
  const aHi = hi <= 185 ? bassAcf(hi) : -1;
  const drums = Math.max(aLo, aHi) >= DRUMS_MIN;
  const near = (a: number, b: number) => Math.abs(a - b) / b < 0.08;
  const bass: [number, number] = [Math.round(aLo * 100) / 100, Math.round(aHi * 100) / 100];

  if (!drums) {
    const d = { detected: g60.bpm, chosen: g60.bpm, offset: g60.offset, drums, hint, bass };
    if (hint && near(hint, g60.bpm)) return { ...d, reason: 'баллада без бочки, совпадает с Deezer' };
    if (hint && near(hint, g60.bpm * 2)) {
      return { ...d, reason: `баллада без бочки; Deezer ${hint} — удвоение, не берём` };
    }
    return { ...d, reason: 'баллада без бочки, диапазон 60–180' };
  }

  const ratio = aLo > 0 ? aHi / aLo : aHi > 0 ? 9 : 0;
  let useHi = aHi >= 0 && ratio >= 0.6;
  let reason = useHi ? 'бочка на каждую долю' : 'бочка через долю — медленный грув';
  // неоднозначная зона: подсказка Deezer решает октаву
  if (hint && aHi >= 0 && ratio > 0.45 && ratio < 0.75) {
    if (near(hint, hi)) { useHi = true; reason = 'неоднозначно, октаву подсказал Deezer'; }
    else if (near(hint, lo)) { useHi = false; reason = 'неоднозначно, октаву подсказал Deezer'; }
  }
  const chosen = useHi ? hi : lo;
  const beatSec = 60 / chosen;
  return { detected: g90.bpm, hint, chosen, offset: g90.offset % beatSec, drums, bass, reason };
}

export type AudioAnalysis = { features: MusicFeatures; tempo: TempoDecision; chroma: number[]; duration: number };

export async function analyzeAudio(buffer: AudioBuffer, opts: { bpmHint?: number; year?: number }): Promise<AudioAnalysis> {
  const signal = mono(buffer);
  const sr = buffer.sampleRate;

  // 1. Кадры 2048 / шаг 1024: RMS, центроид, басовая огибающая атак (спектральный поток < 150 Гц)
  M.bufferSize = FRAME;
  M.sampleRate = sr;
  const kBass = Math.max(2, Math.round((BASS_HZ * FRAME) / sr));
  const frameRms: number[] = [];
  const bassFlux: number[] = [];
  let prevBass: Float32Array | null = null;
  let centroidSum = 0;
  let centroidN = 0;
  const frame = new Float32Array(FRAME);
  for (let start = 0; start + FRAME <= signal.length; start += HOP) {
    frame.set(signal.subarray(start, start + FRAME));
    const f = M.extract(['rms', 'spectralCentroid', 'amplitudeSpectrum'], frame) as Record<string, unknown> | null;
    if (!f) continue;
    const rms = Number(f.rms) || 0;
    frameRms.push(rms);
    const c = Number(f.spectralCentroid);
    if (rms > 0.01 && Number.isFinite(c)) {
      centroidSum += c;
      centroidN++;
    }
    const spec = f.amplitudeSpectrum as ArrayLike<number>;
    const bass = new Float32Array(kBass);
    for (let k = 1; k < kBass; k++) bass[k] = Math.log1p(100 * spec[k]);
    let flux = 0;
    if (prevBass) for (let k = 1; k < kBass; k++) flux += Math.max(0, bass[k] - prevBass[k]);
    bassFlux.push(flux);
    prevBass = bass;
  }

  // 2. Темп и первая доля
  const range = async (minTempo: number): Promise<Guess> => {
    try {
      return await guess(buffer, { minTempo, maxTempo: 180 });
    } catch {
      return { bpm: 0, offset: 0 }; // «нет различимых долей»
    }
  };
  const [g60, g90] = [await range(60), await range(90)];
  if (!g60.bpm && !g90.bpm) throw new Error('В записи не нашлось различимых долей');
  const tempo = decideTempo(g60.bpm ? g60 : g90, g90.bpm ? g90 : g60, (b) => acfAtTempo(bassFlux, sr / HOP, b), opts.bpmHint);
  const bpm = Math.round(tempo.chosen * 10) / 10;
  const beatSec = 60 / bpm;
  const beatOffset = ((tempo.offset % beatSec) + beatSec) % beatSec;

  // 3. Хрома: кадры 8192 / шаг 4096, каждый кадр нормирован (громкие места не перевешивают)
  M.bufferSize = CHROMA_FRAME;
  const pcs = new Int8Array(CHROMA_FRAME / 2).fill(-1);
  for (let k = 1; k < pcs.length; k++) {
    const hz = (k * sr) / CHROMA_FRAME;
    if (hz < 80 || hz > 5000) continue;
    pcs[k] = ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12; // 0 = C
  }
  const chroma = new Array<number>(12).fill(0);
  const cframe = new Float32Array(CHROMA_FRAME);
  for (let start = 0; start + CHROMA_FRAME <= signal.length; start += CHROMA_FRAME / 2) {
    cframe.set(signal.subarray(start, start + CHROMA_FRAME));
    const spec = M.extract('amplitudeSpectrum', cframe) as ArrayLike<number> | null;
    if (!spec) continue;
    const local = new Array<number>(12).fill(0);
    for (let k = 1; k < pcs.length; k++) if (pcs[k] >= 0) local[pcs[k]] += spec[k];
    const sum = local.reduce((s, v) => s + v, 0);
    if (sum > 1e-3) for (let i = 0; i < 12; i++) chroma[i] += local[i] / sum;
  }
  M.bufferSize = FRAME;

  // огибающая RMS → 20 значений в секунду, 0..1
  const framesPerSec = sr / HOP;
  const duration = buffer.duration;
  const envLen = Math.max(1, Math.floor(duration * ENV_RATE));
  const env: number[] = [];
  for (let i = 0; i < envLen; i++) {
    const a = Math.floor((i / ENV_RATE) * framesPerSec);
    const b = Math.max(a + 1, Math.floor(((i + 1) / ENV_RATE) * framesPerSec));
    let s = 0;
    let n = 0;
    for (let j = a; j < b && j < frameRms.length; j++) { s += frameRms[j]; n++; }
    env.push(n ? s / n : 0);
  }
  const maxEnv = Math.max(1e-6, ...env);
  const rmsEnvelope = env.map((v) => Math.round((v / maxEnv) * 1000) / 1000);
  const meanRaw = frameRms.reduce((s, v) => s + v, 0) / Math.max(1, frameRms.length);
  // превью мастерятся громко: RMS ≈ 0.05 (тихо) … 0.3 (очень плотно)
  const rmsMean = Math.min(1, Math.max(0, (meanRaw - 0.03) / 0.27));

  // центроид в бинах → Гц → 0..1 (5 кГц ≈ очень ярко)
  const centroidHz = centroidN ? ((centroidSum / centroidN) * sr) / FRAME : 0;
  const brightness = Math.min(1, centroidHz / 5000);

  const chromaSum = chroma.reduce((s, v) => s + v, 0) || 1;
  const chromaNorm = chroma.map((v) => v / chromaSum);
  const key = detectKey(chromaNorm);

  return {
    features: {
      bpm,
      beatOffset: Math.round(beatOffset * 1000) / 1000,
      barSeconds: (4 * 60) / bpm,
      rmsEnvelope,
      rmsMean: Math.round(rmsMean * 100) / 100,
      brightness: Math.round(brightness * 100) / 100,
      key: key.key,
      mode: key.mode,
      modeConfidence: Math.round(key.confidence * 100) / 100,
      era: eraFromYear(opts.year),
      source: 'audio',
    },
    tempo,
    chroma: chromaNorm,
    duration,
  };
}

/**
 * Огибающая RMS прямо из буфера (20 значений в секунду, 0..1) — для дней, у которых её нет
 * (демо-дни хранят только компактные признаки), считается при первом проигрывании.
 */
export function envelopeFromBuffer(buffer: AudioBuffer): number[] {
  const signal = mono(buffer);
  const win = Math.max(1, Math.round(buffer.sampleRate / ENV_RATE));
  const env: number[] = [];
  for (let start = 0; start + win <= signal.length; start += win) {
    let s = 0;
    for (let i = start; i < start + win; i++) s += signal[i] * signal[i];
    env.push(Math.sqrt(s / win));
  }
  const max = Math.max(1e-6, ...env);
  return env.map((v) => Math.round((v / max) * 1000) / 1000);
}

/** Превью через наш сервер (свежая подписанная ссылка каждый раз) + подсказка BPM из заголовка. */
export async function fetchPreview(source: string, id: string): Promise<{ data: ArrayBuffer; bpmHint?: number }> {
  const r = await fetch(`/api/music/preview?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`);
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `Превью недоступно (${r.status})`);
  }
  const hint = Number(r.headers.get('X-Deezer-Bpm'));
  return { data: await r.arrayBuffer(), bpmHint: hint > 0 ? hint : undefined };
}
