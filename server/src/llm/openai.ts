/**
 * OpenAI через официальный SDK: Chat Completions + `response_format` json_schema (strict).
 * Ретраи SDK выключены: повтор делает analyze.ts — ровно один.
 */
import OpenAI from 'openai';
import { ANALYSIS_JSON_SCHEMA } from './schema.js';
import { LlmError, llmTimeoutMs, type LlmProvider, type LlmRequest } from './provider.js';

export function createOpenAIProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
  // без OPENAI_API_KEY конструктор бросает — resolveProvider превратит это в эвристику
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY?.trim() || undefined, timeout: llmTimeoutMs(env), maxRetries: 0 });

  return {
    id: 'openai',
    model,
    async complete(req: LlmRequest): Promise<string> {
      const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
      req.images.forEach((img, i) => {
        parts.push({ type: 'text', text: `Кадр ${i}:` });
        parts.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}`, detail: 'auto' } });
      });
      parts.push({ type: 'text', text: req.text });
      if (req.feedback) parts.push({ type: 'text', text: req.feedback });

      let res: OpenAI.Chat.ChatCompletion;
      try {
        res = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: parts },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'day_analysis', strict: true, schema: ANALYSIS_JSON_SCHEMA },
          },
          max_completion_tokens: 4000,
        });
      } catch (e) {
        throw mapError(e);
      }

      const choice = res.choices[0];
      if (!choice) throw new LlmError('пустой ответ модели', 'other', true);
      if (choice.message.refusal) throw new LlmError(`модель отказалась отвечать: ${choice.message.refusal}`, 'refusal', false);
      if (choice.finish_reason === 'length') throw new LlmError('ответ обрезан по длине', 'truncated', true);
      const text = choice.message.content ?? '';
      if (!text.trim()) throw new LlmError('пустой ответ модели', 'other', true);
      return text;
    },
  };
}

function mapError(e: unknown): LlmError {
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) {
    return new LlmError(`нет доступа к OpenAI (${e.status}): проверьте OPENAI_API_KEY`, 'auth', false);
  }
  if (e instanceof OpenAI.BadRequestError || e instanceof OpenAI.NotFoundError) {
    return new LlmError(`OpenAI отклонил запрос (${e.status}): ${e.message}`, 'bad_request', false);
  }
  if (e instanceof OpenAI.RateLimitError) return new LlmError('лимит запросов OpenAI (429)', 'transient', true);
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new LlmError('OpenAI не ответил вовремя', 'transient', true);
  if (e instanceof OpenAI.APIConnectionError) return new LlmError('нет связи с OpenAI', 'transient', true);
  if (e instanceof OpenAI.APIError) {
    const status = typeof e.status === 'number' ? e.status : undefined;
    const retry = status === undefined || status === 408 || status === 409 || status >= 500;
    return new LlmError(`ошибка OpenAI ${status ?? ''}: ${e.message}`.trim(), retry ? 'transient' : 'other', retry);
  }
  return new LlmError(`OpenAI недоступен: ${(e as Error)?.message ?? String(e)}`, 'auth', false);
}
