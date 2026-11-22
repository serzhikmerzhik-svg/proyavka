/**
 * Claude через официальный SDK. Structured outputs (`output_config.format`) + серверные
 * fallbacks на случай отказа модели. Ретраи SDK выключены: повтор делает analyze.ts — ровно один.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ANALYSIS_JSON_SCHEMA } from './schema.js';
import { LlmError, llmTimeoutMs, type LlmProvider, type LlmRequest } from './provider.js';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function createAnthropicProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const model = env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5';
  // Короткое извлечение по схеме — низкого усилия достаточно; у Opus 5.5 по умолчанию medium.
  const effort: Effort = EFFORTS.find((e) => e === env.ANTHROPIC_EFFORT?.trim()) ?? 'low';
  // Ключ из ANTHROPIC_API_KEY; если его нет — SDK ищет сам (ANTHROPIC_AUTH_TOKEN, профиль `ant auth login`).
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    timeout: llmTimeoutMs(env),
    maxRetries: 0,
  });

  return {
    id: 'anthropic',
    model,
    async complete(req: LlmRequest): Promise<string> {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      req.images.forEach((img, i) => {
        content.push({ type: 'text', text: `Кадр ${i}:` });
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      });
      content.push({ type: 'text', text: req.text });
      if (req.feedback) content.push({ type: 'text', text: req.feedback });

      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: 'user', content }],
          output_config: { effort, format: { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA } },
          // при отказе модели запрос сам продолжится на подходящей модели
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (e) {
        throw mapError(e);
      }

      if (res.stop_reason === 'refusal') {
        throw new LlmError(`модель отказалась отвечать (${res.stop_details?.category ?? 'без категории'})`, 'refusal', false);
      }
      if (res.stop_reason === 'max_tokens') throw new LlmError('ответ обрезан по max_tokens', 'truncated', true);
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      if (!text.trim()) throw new LlmError('пустой ответ модели', 'other', true);
      return text;
    },
  };
}

function mapError(e: unknown): LlmError {
  // от частного к общему
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new LlmError(`нет доступа к Claude (${e.status}): проверьте ANTHROPIC_API_KEY`, 'auth', false);
  }
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) {
    return new LlmError(`Claude отклонил запрос (${e.status}): ${e.message}`, 'bad_request', false);
  }
  if (e instanceof Anthropic.RateLimitError) return new LlmError('лимит запросов Claude (429)', 'transient', true);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new LlmError('Claude не ответил вовремя', 'transient', true);
  if (e instanceof Anthropic.APIConnectionError) return new LlmError('нет связи с Claude', 'transient', true);
  if (e instanceof Anthropic.APIError) {
    const retry = e.status === undefined || e.status === 408 || e.status === 409 || e.status >= 500;
    return new LlmError(`ошибка Claude ${e.status ?? ''}: ${e.message}`.trim(), retry ? 'transient' : 'other', retry);
  }
  // в том числе «не найден способ аутентификации», если ключа нет совсем
  return new LlmError(`Claude недоступен: ${(e as Error)?.message ?? String(e)}`, 'auth', false);
}
