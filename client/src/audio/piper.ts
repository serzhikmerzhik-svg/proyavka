/**
 * Мягкий человеческий голос прямо на устройстве — когда у сервера нет ключа озвучки (или сервера нет вовсе,
 * как на GitHub Pages). Нейросеть Piper (VITS), русский голос «Ирина» (ru_RU-irina-medium): модель (~60 МБ)
 * один раз скачивается с Hugging Face и хранится в браузере, текст дневника устройство не покидает.
 * Подстройка под атмосферу — темпом при воспроизведении: тихий день — медленнее и ниже, яркий — живее.
 */
export const ON_DEVICE_VOICE = 'ru_RU-irina-medium' as const;
export const ON_DEVICE_VOICE_NAME = 'Ирина (Piper, на устройстве)';

/** Синтез в WAV; onProgress — доля скачанной модели (0..1), при повторных запусках модель уже в кэше. */
export async function synthesizeOnDevice(text: string, onProgress?: (share: number) => void): Promise<Blob> {
  const tts = await import('@diffusionstudio/vits-web');
  return tts.predict({ text, voiceId: ON_DEVICE_VOICE }, (p) => {
    if (p.total > 0) onProgress?.(Math.min(1, p.loaded / p.total));
  });
}

/** Голос, синтезированный на устройстве, — WAV (сервер отдаёт mp3, у него темп уже учтён). */
export const isOnDeviceVoice = (voice: Blob) => /wav/i.test(voice.type);

/** Темп голоса на устройстве: тихий день (энергия 0) — 0,9, яркий (1) — 1,02. */
export const onDeviceRate = (energy: number) => Math.round((0.9 + 0.12 * Math.min(1, Math.max(0, energy))) * 100) / 100;
