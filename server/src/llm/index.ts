/** Выбор провайдера по .env: LLM_PROVIDER = anthropic | openai | none. */
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';
import type { LlmProvider } from './provider.js';

export type ProviderChoice =
  | { provider: LlmProvider; reason?: undefined }
  | { provider: null; reason: string };

/**
 * Явный LLM_PROVIDER главнее. Если он не задан — берём того, чей ключ есть в окружении.
 * Нет ни того ни другого — эвристика (демо-режим без ключей).
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ProviderChoice {
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();
  const choice =
    explicit || (env.ANTHROPIC_API_KEY?.trim() ? 'anthropic' : env.OPENAI_API_KEY?.trim() ? 'openai' : 'none');

  if (choice === 'none') {
    return { provider: null, reason: explicit ? 'LLM_PROVIDER=none' : 'ключ модели не задан' };
  }
  try {
    if (choice === 'anthropic') return { provider: createAnthropicProvider(env) };
    if (choice === 'openai') return { provider: createOpenAIProvider(env) };
  } catch (e) {
    return { provider: null, reason: `${choice}: ${(e as Error).message}` };
  }
  return { provider: null, reason: `неизвестный LLM_PROVIDER «${choice}»` };
}

let cached: ProviderChoice | null = null;
/** Провайдер создаётся один раз, при первом запросе (к этому моменту .env уже прочитан). */
export function getProvider(): ProviderChoice {
  cached ??= resolveProvider();
  return cached;
}

export { LlmError, type LlmProvider } from './provider.js';
