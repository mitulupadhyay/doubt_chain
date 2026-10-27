import { env } from '../config/env.js'

export type EmbeddingProviderName = 'openai' | 'gemini' | 'huggingface'
export type LlmProviderName = 'openai' | 'gemini' | 'groq'

export type EmbeddingConfig = {
  provider: EmbeddingProviderName
  apiKey: string
  baseUrl: string
  model: string
  dimensions: number
  batchSize: number
  timeoutMs: number
}

export type LlmConfig = {
  provider: LlmProviderName
  apiKey: string
  baseUrl: string
  model: string
  maxOutputTokens: number
  timeoutMs: number
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  huggingface: 'https://api-inference.huggingface.co'
}

const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
  huggingface: 'intfloat/multilingual-e5-small'
}

const DEFAULT_LLM_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  groq: 'llama-3.1-8b-instant'
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Resolve embedding provider settings from environment variables.
 * Returns `null` when no embedding key is configured — semantic features then
 * degrade to keyword search instead of pretending to be vector search.
 */
export function resolveEmbeddingConfig(
  source: NodeJS.ProcessEnv = process.env
): EmbeddingConfig | null {
  const apiKey = clean(source.EMBEDDING_API_KEY) ?? clean(source.LLM_API_KEY) ?? clean(source.AI_API_KEY)
  if (!apiKey) return null

  // If no embedding provider is named, reuse a compatible LLM provider name
  // (groq has no embeddings endpoint, so it falls back to the OpenAI default).
  const configured = clean(source.EMBEDDING_PROVIDER) as EmbeddingProviderName | undefined
  const llmProvider = clean(source.LLM_PROVIDER)
  const inferred: EmbeddingProviderName =
    llmProvider === 'gemini' ? 'gemini' : llmProvider === 'openai' ? 'openai' : 'openai'
  const provider = configured ?? inferred

  // `env` already validates/coerces the numeric knobs; prefer it so tests that
  // mutate process.env at runtime still get sane defaults.
  const dimensions = Number(clean(source.EMBEDDING_DIMENSIONS) ?? env.EMBEDDING_DIMENSIONS ?? 1536)
  const batchSize = Number(clean(source.EMBEDDING_BATCH_SIZE) ?? env.EMBEDDING_BATCH_SIZE ?? 16)
  const timeoutMs = Number(clean(source.AI_REQUEST_TIMEOUT_MS) ?? env.AI_REQUEST_TIMEOUT_MS ?? 20000)

  return {
    provider,
    apiKey,
    baseUrl:
      clean(source.EMBEDDING_BASE_URL) ?? DEFAULT_BASE_URLS[provider] ?? DEFAULT_BASE_URLS.openai,
    model: clean(source.EMBEDDING_MODEL) ?? DEFAULT_EMBEDDING_MODELS[provider] ?? 'text-embedding-3-small',
    dimensions,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 16,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 20000
  }
}

export function resolveLlmConfig(source: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = clean(source.LLM_API_KEY) ?? clean(source.AI_API_KEY)
  if (!apiKey) return null

  const provider = (clean(source.LLM_PROVIDER) as LlmProviderName | undefined) ?? 'openai'
  const timeoutMs = Number(clean(source.AI_REQUEST_TIMEOUT_MS) ?? env.AI_REQUEST_TIMEOUT_MS ?? 20000)
  const maxOutputTokens = Number(
    clean(source.AI_MAX_OUTPUT_TOKENS) ?? env.AI_MAX_OUTPUT_TOKENS ?? 900
  )

  return {
    provider,
    apiKey,
    baseUrl: clean(source.LLM_BASE_URL) ?? DEFAULT_BASE_URLS[provider] ?? DEFAULT_BASE_URLS.openai,
    model: clean(source.LLM_MODEL) ?? DEFAULT_LLM_MODELS[provider] ?? 'gpt-4o-mini',
    maxOutputTokens:
      Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 900,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 20000
  }
}

/** Non-secret capability report for the frontend (never leaks keys or base URLs). */
export function aiCapabilityStatus() {
  const embedding = resolveEmbeddingConfig()
  const llm = resolveLlmConfig()
  return {
    embeddingsConfigured: Boolean(embedding),
    embeddingsProvider: embedding?.provider ?? null,
    embeddingsModel: embedding?.model ?? null,
    embeddingsDimensions: embedding?.dimensions ?? null,
    assistantConfigured: Boolean(llm),
    assistantProvider: llm?.provider ?? null,
    assistantModel: llm?.model ?? null,
    semanticSearchEnabled: env.SEMANTIC_SEARCH_ENABLED,
    autoIndexingEnabled: env.EMBEDDING_AUTO_INDEX
  }
}
