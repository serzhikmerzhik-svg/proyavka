/**
 * POST /api/analyze — смысл текста и кадров (SPEC §4.4).
 * Модель по LLM_PROVIDER → ответ строго по схеме → zod. При ошибке ровно один повтор
 * (с описанием, что не так), затем эвристика. Без ключа — сразу эвристика.
 */
import type { Request, Response } from 'express';
import { AnalyzeRequestSchema, TextAnalysisSchema, type AnalyzeRequest, type TextAnalysis } from './types.js';
import { analyzeHeuristic } from './heuristic.js';
import { getProvider, LlmError, type LlmProvider } from './llm/index.js';
import { SYSTEM_PROMPT, buildUserText, retryFeedback } from './llm/prompt.js';
import { parseAnalysis } from './llm/schema.js';

export type AnalyzeResult = {
  analysis: TextAnalysis;
  source: 'llm' | 'heuristic';
  provider?: LlmProvider['id'];
  model?: string;
  /** сколько запросов к модели ушло (0 — модель не вызывалась) */
  attempts: number;
  /** почему эвристика, если она */
  fallbackReason?: string;
};

const MAX_ATTEMPTS = 2; // первый запрос + один повтор
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function heuristic(req: AnalyzeRequest, reason: string, attempts: number, provider?: LlmProvider): AnalyzeResult {
  return {
    analysis: TextAnalysisSchema.parse(analyzeHeuristic(req)),
    source: 'heuristic',
    provider: provider?.id,
    model: provider?.model,
    attempts,
    fallbackReason: reason,
  };
}

export async function analyzeDay(
  req: AnalyzeRequest,
  provider: LlmProvider | null,
  noProviderReason = 'модель не настроена',
  opts: { retryDelayMs?: number } = {},
): Promise<AnalyzeResult> {
  if (!provider) return heuristic(req, noProviderReason, 0);

  const text = buildUserText(req);
  const photoCount = Math.max(req.photoCount, req.photos.length);
  let feedback: string | undefined;
  let lastError = 'неизвестная ошибка';
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const raw = await provider.complete({ system: SYSTEM_PROMPT, text, images: req.photos, feedback });
      const parsed = parseAnalysis(raw, photoCount);
      if (parsed.ok) {
        return { analysis: parsed.analysis, source: 'llm', provider: provider.id, model: provider.model, attempts };
      }
      lastError = `ответ не прошёл проверку (${parsed.error})`;
      feedback = retryFeedback(parsed.error);
    } catch (e) {
      const err = e instanceof LlmError ? e : new LlmError((e as Error)?.message ?? String(e), 'other', true);
      lastError = err.message;
      if (!err.retryable) break;
      feedback = undefined; // сбой сети или лимит — повторяем тот же запрос
      if (err.kind === 'transient') await sleep(opts.retryDelayMs ?? 800);
    }
    // текст дня в логи не пишем — только причину
    console.warn(`[analyze] ${provider.id}/${provider.model}, попытка ${attempts}: ${lastError}`);
  }
  return heuristic(req, lastError, attempts, provider);
}

export async function analyzeHandler(req: Request, res: Response) {
  const parsed = AnalyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректный запрос', issues: parsed.error.issues.slice(0, 5) });
    return;
  }
  const choice = getProvider();
  res.json(await analyzeDay(parsed.data, choice.provider, choice.reason));
}
