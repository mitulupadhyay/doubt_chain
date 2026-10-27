export type AiErrorKind =
  | 'not_configured'
  | 'timeout'
  | 'http'
  | 'network'
  | 'invalid_response'
  | 'rate_limited'

/**
 * Raised whenever an upstream embedding/LLM provider cannot fulfil a request.
 *
 * Callers must never paper over this with fabricated content. Semantic search
 * degrades to keyword search (and says so), while the AI assistant surfaces an
 * explicit 503 to the client.
 */
export class AiProviderError extends Error {
  readonly kind: AiErrorKind
  readonly provider: string
  readonly statusCode?: number
  readonly retryable: boolean

  constructor(
    kind: AiErrorKind,
    message: string,
    options: { provider: string; statusCode?: number; retryable?: boolean }
  ) {
    super(message)
    this.name = 'AiProviderError'
    this.kind = kind
    this.provider = options.provider
    this.statusCode = options.statusCode
    this.retryable = options.retryable ?? (kind === 'timeout' || kind === 'network')
  }
}

export function isAiProviderError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError
}

/** Short, user-safe reason string — never includes prompts, keys or raw payloads. */
export function describeAiError(error: unknown): string {
  if (isAiProviderError(error)) {
    switch (error.kind) {
      case 'not_configured':
        return 'AI provider is not configured'
      case 'timeout':
        return 'AI provider timed out'
      case 'rate_limited':
        return 'AI provider rate limit reached'
      case 'network':
        return 'AI provider is unreachable'
      case 'invalid_response':
        return 'AI provider returned an unusable response'
      default:
        return 'AI provider request failed'
    }
  }
  return 'AI provider request failed'
}
