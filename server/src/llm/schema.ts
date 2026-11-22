/**
 * Схема ответа модели. Одна JSON-схема для structured outputs обоих провайдеров
 * (Anthropic `output_config.format`, OpenAI `response_format` strict) и zod-проверка поверх неё.
 *
 * В JSON-схеме нет minimum/maximum и ограничений длины: structured outputs поддерживают их не везде.
 * Диапазоны описаны словами в промпте и проверяются zod — нарушение даёт повтор запроса.
 * Необязательные cold/warm сделаны обязательными строками («» — нет), чтобы не зависеть от поддержки null.
 */
import { z } from 'zod';
import { AIRS, PROCESS_IDS, SEASONS, TIMES, TextAnalysisSchema, type TextAnalysis } from '../types.js';

const unitJson = { type: 'number', description: 'Число от 0 до 1' } as const;

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'atmosphere', 'label', 'timeOfDay', 'season', 'contrast', 'air',
    'captionQuote', 'folderNames', 'voiceStyle', 'bestPhotoIndex', 'photoNotes',
  ],
  properties: {
    atmosphere: {
      type: 'object',
      additionalProperties: false,
      required: ['energy', 'tone', 'together', 'special'],
      properties: { energy: unitJson, tone: unitJson, together: unitJson, special: unitJson },
    },
    label: { type: 'string', enum: [...PROCESS_IDS] },
    timeOfDay: { type: 'string', enum: [...TIMES] },
    season: { type: 'string', enum: [...SEASONS] },
    contrast: {
      type: 'object',
      additionalProperties: false,
      required: ['has', 'cold', 'warm'],
      properties: {
        has: { type: 'boolean' },
        cold: { type: 'string', description: '1–3 слова из текста или пустая строка' },
        warm: { type: 'string', description: '1–3 слова из текста или пустая строка' },
      },
    },
    air: { type: 'array', items: { type: 'string', enum: [...AIRS] } },
    captionQuote: { type: 'string', description: '2–6 слов подряд дословно из текста дня' },
    folderNames: { type: 'array', items: { type: 'string' }, description: 'Ровно 5 вариантов по 3–7 слов' },
    voiceStyle: { type: 'string' },
    bestPhotoIndex: { type: 'integer', description: 'Номер кадра с нуля' },
    photoNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'scene', 'people'],
        properties: {
          index: { type: 'integer' },
          scene: { type: 'string' },
          people: { type: 'boolean' },
        },
      },
    },
  },
} as const;

const unit = z.number().min(0).max(1);

/** Ответ модели как есть (до нормализации). */
export const LlmAnalysisSchema = z.object({
  atmosphere: z.object({ energy: unit, tone: unit, together: unit, special: unit }),
  label: z.enum(PROCESS_IDS),
  timeOfDay: z.enum(TIMES),
  season: z.enum(SEASONS),
  contrast: z.object({ has: z.boolean(), cold: z.string(), warm: z.string() }),
  air: z.array(z.enum(AIRS)),
  captionQuote: z.string().trim().min(1),
  folderNames: z.array(z.string()).min(1),
  voiceStyle: z.string().trim().min(1),
  bestPhotoIndex: z.number().int(),
  photoNotes: z.array(z.object({ index: z.number().int(), scene: z.string(), people: z.boolean() })),
});

export type ParseResult = { ok: true; analysis: TextAnalysis } | { ok: false; error: string };

const formatIssues = (issues: z.ZodIssue[]) =>
  issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
    .join('; ');

/**
 * Сырой текст ответа → проверенный TextAnalysis.
 * Схемные ошибки возвращаются текстом (уйдут в повторный запрос). Мелочи, которые можно исправить
 * детерминированно (номер кадра вне диапазона, пустой контраст), исправляются без повтора.
 */
export function parseAnalysis(raw: string, photoCount: number): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'ответ не является корректным JSON' };
  }
  const r = LlmAnalysisSchema.safeParse(json);
  if (!r.success) return { ok: false, error: formatIssues(r.error.issues) };
  const a = r.data;

  const cold = a.contrast.cold.trim();
  const warm = a.contrast.warm.trim();
  const hasContrast = a.contrast.has && cold.length > 0 && warm.length > 0;
  const lastPhoto = Math.max(0, photoCount - 1);

  const analysis: TextAnalysis = {
    atmosphere: a.atmosphere,
    label: a.label,
    timeOfDay: a.timeOfDay,
    season: a.season,
    contrast: hasContrast ? { has: true, cold, warm } : { has: false },
    air: [...new Set(a.air)],
    captionQuote: a.captionQuote,
    folderNames: a.folderNames.map((n) => n.trim()).filter(Boolean),
    voiceStyle: a.voiceStyle,
    bestPhotoIndex: Math.min(Math.max(0, a.bestPhotoIndex), lastPhoto),
    photoNotes: a.photoNotes
      .filter((n) => n.index >= 0 && n.index < photoCount)
      .map((n) => ({ index: n.index, scene: n.scene.trim(), people: n.people })),
  };
  if (analysis.folderNames.length === 0) return { ok: false, error: 'folderNames: нет ни одного варианта' };
  return { ok: true, analysis: TextAnalysisSchema.parse(analysis) };
}
