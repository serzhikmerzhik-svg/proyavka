/** Видео ИИ-оживления как источник кадров: без звука, по кругу, inline — запускается и без жеста. */
export type LoadedVideo = { video: HTMLVideoElement; url: string };

const OPEN_ERROR = 'браузер не смог открыть видео';

/** Открыть видео до первого кадра (readyState ≥ 2). Битое или «вечно грузящееся» — ошибка по таймауту. */
export async function loadVideo(blob: Blob, timeoutMs = 20_000): Promise<LoadedVideo> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(OPEN_ERROR)), timeoutMs);
      video.addEventListener('loadeddata', () => (clearTimeout(timer), resolve()), { once: true });
      video.addEventListener('error', () => (clearTimeout(timer), reject(new Error(OPEN_ERROR))), { once: true });
      video.src = url;
      // iOS не грузит видео без play(); беззвучное inline-видео браузеры разрешают запускать без жеста
      video.play().then(() => video.pause(), () => undefined);
    });
  } catch (e) {
    unloadVideo({ video, url });
    throw e;
  }
  return { video, url };
}

export function unloadVideo({ video, url }: LoadedVideo) {
  video.pause();
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(url);
}
