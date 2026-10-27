import { AiProviderError } from './errors.js'
import { EmbeddingConfig, resolveEmbeddingConfig } from './config.js'

export type EmbeddingResult = {
  vectors: number[][]
  model: string
  dimensions: number
  provider: string
}

export type EmbeddingProvider = {
  readonly provider: string
  readonly model: string
  readonly dimensions: number
  embed(texts: string[]): Promise<EmbeddingResult>
}

/** Chunk an array into fixed-size batches. */
export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  const step = Math.max(1, size)
  for (let i = 0; i < items.length; i += step) {
    batches.push(items.slice(i, i + step))
  }
  return batches
}

/** L2-normalise a vector so cosine similarity == dot product. */
export function normalizeVector(vector: number[]): number[] {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum)
  if (!Number.isFinite(norm) || norm === 0) return vector.slice()
  return vector.map((value) => value / norm)
}

/**
 * Convert a vector to the pgvector text literal `[1,2,3]`.
 * Values are clamped to a fixed precision to keep payloads small.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? Number(value.toFixed(6)) : 0)).join(',')}]`
}

export function isValidVector(vector: unknown, dimensions: number): vector is number[] {
  return (
    Array.isArray(vector) &&
    vector.length === dimensions &&
    vector.every((value) => typeof value === 'number' && Number.isFinite(value))
  )
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  provider: string
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AiProviderError('timeout', `${provider} embedding request timed out`, { provider })
    }
    throw new AiProviderError('network', `${provider} embedding request failed`, {
      provider,
      retryable: true
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    throw new AiProviderError(
      response.status === 429 ? 'rate_limited' : 'http',
      `${provider} embedding request failed with status ${response.status}`,
      { provider, statusCode: response.status, retryable }
    )
  }

  try {
    return (await response.json()) as unknown
  } catch {
    throw new AiProviderError('invalid_response', `${provider} returned invalid JSON`, {
      provider
    })
  }
}

function assertVectors(raw: unknown, expected: number, dimensions: number, provider: string): number[][] {
  if (!Array.isArray(raw) || raw.length !== expected) {
    throw new AiProviderError('invalid_response', `${provider} returned an unexpected vector count`, {
      provider
    })
  }
  const vectors = raw.map((item) => (Array.isArray(item) ? item.map(Number) : []))
  if (vectors.some((vector) => !isValidVector(vector, dimensions))) {
    throw new AiProviderError(
      'invalid_response',
      `${provider} returned vectors with an unexpected dimension (expected ${dimensions})`,
      { provider }
    )
  }
  return vectors
}

/** OpenAI-compatible `/embeddings` endpoint (OpenAI, Together, Ollama, OpenRouter, …). */
function createOpenAiCompatibleProvider(config: EmbeddingConfig): EmbeddingProvider {
  return {
    provider: config.provider,
    model: config.model,
    dimensions: config.dimensions,
    async embed(texts: string[]) {
      if (texts.length === 0) return { vectors: [], model: config.model, dimensions: config.dimensions, provider: config.provider }

      const payload: Record<string, unknown> = { model: config.model, input: texts }
      // `dimensions` is only honoured by newer OpenAI embedding models; sending it
      // to a compatible server that ignores it is harmless.
      payload.dimensions = config.dimensions

      const raw = (await postJson(
        `${config.baseUrl.replace(/\/$/, '')}/embeddings`,
        payload,
        { Authorization: `Bearer ${config.apiKey}` },
        config.timeoutMs,
        config.provider
      )) as { data?: Array<{ embedding?: number[] }> }

      const vectors = (raw?.data ?? []).map((item) => item.embedding ?? [])
      return {
        vectors: assertVectors(vectors, texts.length, config.dimensions, config.provider),
        model: config.model,
        dimensions: config.dimensions,
        provider: config.provider
      }
    }
  }
}

/** Google Generative Language embedding endpoint (`:batchEmbedContents`). */
function createGeminiProvider(config: EmbeddingConfig): EmbeddingProvider {
  return {
    provider: 'gemini',
    model: config.model,
    dimensions: config.dimensions,
    async embed(texts: string[]) {
      if (texts.length === 0) return { vectors: [], model: config.model, dimensions: config.dimensions, provider: 'gemini' }

      const raw = (await postJson(
        `${config.baseUrl.replace(/\/$/, '')}/models/${config.model}:batchEmbedContents?key=${encodeURIComponent(config.apiKey)}`,
        {
          requests: texts.map((text) => ({
            model: `models/${config.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: config.dimensions
          }))
        },
        {},
        config.timeoutMs,
        'gemini'
      )) as { embeddings?: Array<{ values?: number[] }> }

      const vectors = (raw?.embeddings ?? []).map((item) => item.values ?? [])
      return {
        vectors: assertVectors(vectors, texts.length, config.dimensions, 'gemini'),
        model: config.model,
        dimensions: config.dimensions,
        provider: 'gemini'
      }
    }
  }
}

/**
 * Hugging Face Inference API feature-extraction endpoint.
 * Supports both the `[{…}]` (single input) and `[[…]]` (batched) response shapes.
 */
function createHuggingFaceProvider(config: EmbeddingConfig): EmbeddingProvider {
  return {
    provider: 'huggingface',
    model: config.model,
    dimensions: config.dimensions,
    async embed(texts: string[]) {
      if (texts.length === 0) return { vectors: [], model: config.model, dimensions: config.dimensions, provider: 'huggingface' }

      const raw = (await postJson(
        `${config.baseUrl.replace(/\/$/, '')}/models/${config.model}`,
        { inputs: texts, options: { wait_for_model: true } },
        { Authorization: `Bearer ${config.apiKey}` },
        config.timeoutMs,
        'huggingface'
      )) as unknown

      // Normalise: [[...]] (batched) | [{...}] (single sequence of token vectors)
      let rows: number[][] = []
      if (Array.isArray(raw) && Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === 'number') {
        rows = raw as number[][]
      } else if (Array.isArray(raw) && Array.isArray(raw[0])) {
        rows = (raw as number[][][]).map((tokenVectors) => meanPool(tokenVectors))
      } else {
        throw new AiProviderError('invalid_response', 'huggingface returned an unexpected payload', {
          provider: 'huggingface'
        })
      }

      // e5-family models expose 384 dims; pad/trim to keep the DB column valid.
      const fitted = rows.map((row) => fitDimensions(normalizeVector(row), config.dimensions))
      return {
        vectors: assertVectors(fitted, texts.length, config.dimensions, 'huggingface'),
        model: config.model,
        dimensions: config.dimensions,
        provider: 'huggingface'
      }
    }
  }
}

/** Mean-pool token-level vectors into a single sentence vector. */
export function meanPool(tokenVectors: number[][]): number[] {
  if (tokenVectors.length === 0) return []
  const dimensions = tokenVectors[0].length
  const out = new Array(dimensions).fill(0)
  for (const vector of tokenVectors) {
    for (let i = 0; i < dimensions; i += 1) out[i] += vector[i] ?? 0
  }
  return out.map((value) => value / tokenVectors.length)
}

export function fitDimensions(vector: number[], dimensions: number): number[] {
  if (vector.length === dimensions) return vector
  if (vector.length > dimensions) return vector.slice(0, dimensions)
  return [...vector, ...new Array(dimensions - vector.length).fill(0)]
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'gemini':
      return createGeminiProvider(config)
    case 'huggingface':
      return createHuggingFaceProvider(config)
    default:
      return createOpenAiCompatibleProvider(config)
  }
}

let cached: { key: string; provider: EmbeddingProvider } | null = null

/**
 * Returns the configured embedding provider, or `null` when no key is present.
 * The instance is cached per configuration so repeated search calls reuse it.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const config = resolveEmbeddingConfig()
  if (!config) return null
  const key = `${config.provider}|${config.model}|${config.dimensions}|${config.baseUrl}`
  if (cached?.key === key) return cached.provider
  const provider = createEmbeddingProvider(config)
  cached = { key, provider }
  return provider
}

/** Test helper: drop the memoised provider. */
export function resetEmbeddingProvider(): void {
  cached = null
}

export async function embedTexts(
  texts: string[],
  provider: EmbeddingProvider | null = getEmbeddingProvider()
): Promise<EmbeddingResult> {
  if (!provider) {
    throw new AiProviderError('not_configured', 'No embedding provider configured', {
      provider: 'none'
    })
  }
  if (texts.length === 0) {
    return { vectors: [], model: provider.model, dimensions: provider.dimensions, provider: provider.provider }
  }

  const vectors: number[][] = []
  const batchSize = resolveEmbeddingConfig()?.batchSize ?? 16
  for (const batch of chunk(texts, batchSize)) {
    const result = await provider.embed(batch)
    vectors.push(...result.vectors)
  }
  return {
    vectors,
    model: provider.model,
    dimensions: provider.dimensions,
    provider: provider.provider
  }
}

export async function embedText(
  text: string,
  provider?: EmbeddingProvider | null
): Promise<{ vector: number[]; model: string; dimensions: number; provider: string }> {
  const result = await embedTexts([text], provider ?? getEmbeddingProvider())
  const vector = result.vectors[0]
  if (!vector) {
    throw new AiProviderError('invalid_response', 'Embedding provider returned no vector', {
      provider: result.provider
    })
  }
  return {
    vector,
    model: result.model,
    dimensions: result.dimensions,
    provider: result.provider
  }
}
