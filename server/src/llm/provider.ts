/** Общий интерфейс языковой модели. Провайдер выбирается переменной LLM_PROVIDER. */

export type LlmImage = { mediaType: 'image/jpeg'; data: string /* base64 без префикса data: */ };

export type LlmRequest = {
  system: string;
  text: string;
  images: LlmImage[];
  /** что не так с прошлым ответом — только для повтора */
  feedback?: string;
};

export type LlmErrorKind = 'auth' | 'bad_request' | 'refusal' | 'truncated' | 'transient' | 'other';

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmProvider {
  readonly id: 'anthropic' | 'openai';
  readonly model: string;
  /** Возвращает сырой текст ответа (JSON по ANALYSIS_JSON_SCHEMA). Ошибки — LlmError. */
  complete(req: LlmRequest): Promise<string>;
}

/** Таймаут одного запроса к модели (читается лениво — .env загружается после импортов). */
export const llmTimeoutMs = (env: NodeJS.ProcessEnv = process.env) => Number(env.LLM_TIMEOUT_MS) || 60_000;
