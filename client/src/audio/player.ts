/**
 * Граф Web Audio:  музыка (BufferSource по кругу) → gain ┐
 *                  голос (озвучка дня)       → gain ┴→ master → выход (+ дорожка для записи видео)
 * Часы — по AudioContext.currentTime, чтобы доли совпадали со звуком, а не с rAF.
 */
import type { MusicFeatures } from '../recipe/types';

export interface Clock {
  /** секунды с начала проявки */
  now(): number;
  dispose(): void;
}

/** Без AudioContext — часы по performance.now(). */
export class TimerClock implements Clock {
  private t0 = performance.now();
  now() {
    return (performance.now() - this.t0) / 1000;
  }
  dispose() {}
}

const MUSIC_LEVEL = 0.9;
const DUCKED = 0.25;

export class SongPlayer implements Clock {
  readonly ctx: AudioContext;
  private master: GainNode;
  private music: GainNode;
  private voice: GainNode;
  private source?: AudioBufferSourceNode;
  private voiceSource?: AudioBufferSourceNode;
  private recDest?: MediaStreamAudioDestinationNode;
  private startAt = 0;
  buffer?: AudioBuffer;

  /** Вызывать синхронно внутри обработчика касания — иначе браузер не даст звук. */
  constructor() {
    this.ctx = new AudioContext();
    void this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    this.voice = this.ctx.createGain();
    this.voice.connect(this.master);
  }

  async load(data: ArrayBuffer | Blob) {
    const ab = data instanceof Blob ? await data.arrayBuffer() : data;
    this.buffer = await this.ctx.decodeAudioData(ab);
  }

  /** Старт часов; музыка — если загружена (без неё часы идут, а голос и запись работают). */
  start() {
    this.startAt = this.ctx.currentTime + 0.05;
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.music);
    src.start(this.startAt);
    this.music.gain.setValueAtTime(0, this.startAt);
    this.music.gain.linearRampToValueAtTime(MUSIC_LEVEL, this.startAt + 0.6);
    this.source = src;
  }

  now() {
    return Math.max(0, this.ctx.currentTime - this.startAt);
  }

  private rampMusic(level: number, seconds: number) {
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(level, t + seconds);
  }

  /** Озвучка поверх музыки: музыка приглушается, пока звучит голос. rate — темп голоса. Возвращает длительность, с. */
  async playVoice(audio: Blob, rate = 1): Promise<number> {
    const buf = await this.ctx.decodeAudioData(await audio.arrayBuffer());
    this.voiceSource?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(this.voice);
    this.rampMusic(DUCKED, 0.8);
    src.onended = () => this.rampMusic(MUSIC_LEVEL, 1.5);
    src.start(this.ctx.currentTime + 0.3);
    this.voiceSource = src;
    return buf.duration / rate + 0.3;
  }

  /** Приглушить музыку под голос, который звучит не через этот граф (голос браузера). */
  duck(on: boolean) {
    this.rampMusic(on ? DUCKED : MUSIC_LEVEL, on ? 0.8 : 1.5);
  }

  /** Дорожка для MediaRecorder: всё, что слышно, — музыка и голос. */
  recordingTrack(): MediaStreamTrack | undefined {
    if (!this.recDest) {
      this.recDest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.recDest);
    }
    return this.recDest.stream.getAudioTracks()[0];
  }

  dispose() {
    for (const s of [this.source, this.voiceSource]) {
      try {
        s?.stop();
      } catch {
        // уже остановлен
      }
    }
    void this.ctx.close();
  }
}

/** Импульс доли: 1 на ударе, экспоненциально гаснет до следующего. */
export function beatAt(t: number, m: Pick<MusicFeatures, 'bpm' | 'beatOffset'>) {
  const beatSec = 60 / m.bpm;
  const phase = (t - m.beatOffset) / beatSec;
  if (phase < 0) return { pulse: 0, index: -1 };
  const frac = phase - Math.floor(phase);
  return { pulse: Math.exp(-frac * 5), index: Math.floor(phase) };
}

/** RMS из огибающей (20 значений/с), с учётом зацикливания превью. */
export function rmsAt(t: number, m: Pick<MusicFeatures, 'rmsEnvelope' | 'rmsMean'>, loopSeconds?: number): number {
  const env = m.rmsEnvelope;
  if (!env.length) return 0.5 + 0.08 * Math.sin(t * 1.3); // без аудио — медленное «дыхание»
  const tt = loopSeconds ? t % loopSeconds : t;
  const x = tt * 20;
  const i = Math.min(env.length - 1, Math.floor(x));
  const j = Math.min(env.length - 1, i + 1);
  return env[i] + (env[j] - env[i]) * (x - Math.floor(x));
}
