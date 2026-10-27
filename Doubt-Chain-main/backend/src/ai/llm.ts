import { AiProviderError } from './errors.js'
import { LlmConfig, resolveLlmConfig } from './config.js'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmCompletion = {
  text: string
  provider: string
  model: string
  latencyMs: number
  usage?: { promptTokens?: number; completionTokens?: number }
}

export type LlmProvider = {
  readonly provider: string
  readonly model: string
  complete(messages: ChatMessage[]): Promise<LlmCompletion>
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
  const started = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch {
    if (controller.signal.aborted) {
      throw new AiProviderError(
        'timeout',
        `${provider} request timed out after ${Date.now() - started}ms`,
        { provider }
      )
    }
    throw new AiProviderError('network', `${provider} request failed`, { provider, retryable: true })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new AiProviderError(
      response.status === 429 ? 'rate_limited' : 'http',
      `${provider} request failed with status ${response.status}`,
      {
        provider,
        statusCode: response.status,
        retryable: response.status === 429 || response.status >= 500
      }
    )
  }

  try {
    return (await response.json()) as unknown
  } catch {
    throw new AiProviderError('invalid_response', `${provider} returned invalid JSON`, { provider })
  }
}

function createOpenAiCompatibleProvider(config: LlmConfig): LlmProvider {
  return {
    provider: config.provider,
    model: config.model,
    async complete(messages: ChatMessage[]) {
      const started = Date.now()
      const raw = (await postJson(
        `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          model: config.model,
          messages,
          temperature: 0.2,
          max_tokens: config.maxOutputTokens
        },
        { Authorization: `Bearer ${config.apiKey}` },
        config.timeoutMs,
        config.provider
      )) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }

      const text = raw?.choices?.[0]?.message?.content?.trim()
      if (!text) {
        throw new AiProviderError('invalid_response', `${config.provider} returned an empty answer`, {
          provider: config.provider
        })
      }
      return {
        text,
        provider: config.provider,
        model: config.model,
        latencyMs: Date.now() - started,
        usage: {
          promptTokens: raw.usage?.prompt_tokens,
          completionTokens: raw.usage?.completion_tokens
        }
      }
    }
  }
}

function createGeminiProvider(config: LlmConfig): LlmProvider {
  return {
    provider: 'gemini',
    model: config.model,
    async complete(messages: ChatMessage[]) {
      const started = Date.now()
      const systemInstruction = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n')
      const contents = messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        }))

      const raw = (await postJson(
        `${config.baseUrl.replace(/\/$/, '')}/models/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
        {
          contents,
          ...(systemInstruction
            ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
            : {}),
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: config.maxOutputTokens
          }
        },
        {},
        config.timeoutMs,
        'gemini'
      )) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      }

      const text = raw?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim()
      if (!text) {
        throw new AiProviderError('invalid_response', 'gemini returned an empty answer', {
          provider: 'gemini'
        })
      }
      return {
        text,
        provider: 'gemini',
        model: config.model,
        latencyMs: Date.now() - started,
        usage: {
          promptTokens: raw.usageMetadata?.promptTokenCount,
          completionTokens: raw.usageMetadata?.candidatesTokenCount
        }
      }
    }
  }
}

export function createLlmProvider(config: LlmConfig): LlmProvider {
  return config.provider === 'gemini'
    ? createGeminiProvider(config)
    : createOpenAiCompatibleProvider(config)
}

let cached: { key: string; provider: LlmProvider } | null = null

export function getLlmProvider(): LlmProvider | null {
  const config = resolveLlmConfig()
  if (!config) return null
  const key = `${config.provider}|${config.model}|${config.baseUrl}`
  if (cached?.key === key) return cached.provider
  cached = { key, provider: createLlmProvider(config) }
  return cached.provider
}

export function resetLlmProvider(): void {
  cached = null
}

export async function completeChat(
  messages: ChatMessage[],
  provider: LlmProvider | null = getLlmProvider()
): Promise<LlmCompletion> {
  if (!provider) {
    throw new AiProviderError('not_configured', 'No AI assistant provider configured', {
      provider: 'none'
    })
  }
  return provider.complete(messages)
}
