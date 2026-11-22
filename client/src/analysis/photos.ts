import exifr from 'exifr';
import { extractPalette } from './palette';
import type { PhotoAsset } from '../recipe/types';

const MAX_SIDE = 1600;

async function readExif(file: File, withGps: boolean): Promise<Pick<PhotoAsset, 'takenAt' | 'gps'>> {
  const out: Pick<PhotoAsset, 'takenAt' | 'gps'> = {};
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] });
    const d: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (d instanceof Date && !Number.isNaN(d.getTime())) out.takenAt = d.toISOString();
    if (withGps) {
      const gps = await exifr.gps(file);
      if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
        out.gps = { lat: gps.latitude, lon: gps.longitude };
      }
    }
  } catch {
    // у фото может не быть EXIF (скриншоты, PNG) — это нормально
  }
  return out;
}

/** Уменьшение до 1600 px, EXIF, палитра. Глубина — TODO (depth-anything в воркере, SPEC §4.3). */
export async function preparePhoto(file: File, withGps: boolean): Promise<PhotoAsset> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сжать фото'))), 'image/jpeg', 0.9),
  );
  const palette = extractPalette(canvas, width, height, 5);
  const exif = await readExif(file, withGps);
  return { blob, width, height, palette, ...exif };
}
