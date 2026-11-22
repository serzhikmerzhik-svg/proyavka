import { z } from 'zod';

export const PROCESS_IDS = [
  'cyanotype', 'autochrome', 'kodachrome', 'instant', 'trichrome',
  'push_montage', 'double_exposure', 'platinum', 'solarization',
] as const;
export type ProcessId = (typeof PROCESS_IDS)[number];

export const TIMES = ['morning', 'day', 'golden_hour', 'evening', 'night', 'unknown'] as const;
export const SEASONS = ['winter', 'spring', 'summer', 'autumn', 'unknown'] as const;
export const AIRS = ['steam', 'leaves', 'snow', 'rain', 'dust', 'fog'] as const;

const unit = z.number().min(0).max(1);

/** Ответ анализа текста. Та же схема будет валидировать ответ LLM. */
export const TextAnalysisSchema = z.object({
  atmosphere: z.object({ energy: unit, tone: unit, together: unit, special: unit }),
  label: z.enum(PROCESS_IDS),
  timeOfDay: z.enum(TIMES),
  season: z.enum(SEASONS),
  contrast: z.object({ has: z.boolean(), cold: z.string().optional(), warm: z.string().optional() }),
  air: z.array(z.enum(AIRS)),
  captionQuote: z.string(),
  folderNames: z.array(z.string()).min(1),
  voiceStyle: z.string(),
  bestPhotoIndex: z.number().int().min(0),
  photoNotes: z.array(z.object({ index: z.number().int(), scene: z.string(), people: z.boolean() })),
});
export type TextAnalysis = z.infer<typeof TextAnalysisSchema>;

export const AnalyzeRequestSchema = z.object({
  text: z.string().min(1).max(20000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  photoCount: z.number().int().min(1).max(6),
  /** ISO-время съёмки из EXIF, если есть */
  takenAt: z.array(z.string()).default([]),
  /** уменьшенные кадры для модели: JPEG до 768 px, base64 без префикса data: */
  photos: z
    .array(
      z.object({
        mediaType: z.literal('image/jpeg'),
        data: z.string().min(16).max(3_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'ожидается base64'),
      }),
    )
    .max(6)
    .default([]),
  song: z.object({
    title: z.string(),
    artist: z.string(),
    year: z.number().int().optional(),
    genre: z.string().optional(),
  }),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
