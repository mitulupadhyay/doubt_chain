import type { AiSource, ExplanationMode, ExplanationModeInfo } from '../types/api'

/**
 * Local mirror of the backend mode catalogue, used as a fallback when the
 * capability report cannot be fetched (e.g. offline dev without a backend).
 * Labels must stay in sync with backend/src/services/ai/modes.ts.
 */
export const FALLBACK_MODES: ExplanationModeInfo[] = [
  {
    id: 'beginner',
    label: "Explain Like I'm a Beginner",
    description: 'Plain language, no assumed background, every term defined.'
  },
  {
    id: 'step_by_step',
    label: 'Explain Step by Step',
    description: 'Numbered reasoning path from question to answer.'
  },
  {
    id: 'simple_example',
    label: 'Give a Simple Example',
    description: 'One small, concrete example that shows the idea.'
  },
  {
    id: 'hinglish',
    label: 'Explain in Hinglish',
    description: 'Romanised Hindi mixed with English technical terms.'
  },
  {
    id: 'debug_code',
    label: 'Help Me Debug This Code',
    description: 'Find the bug, explain the cause, show the fix.'
  }
]

export const DEFAULT_MODE: ExplanationMode = 'beginner'

export function modeLabel(modeId: ExplanationMode, modes: ExplanationModeInfo[] = FALLBACK_MODES): string {
  return modes.find((mode) => mode.id === modeId)?.label ?? modeId
}

/** Human-readable explanation for a degraded retrieval reason from the API. */
export function degradationMessage(reason?: string): string {
  switch (reason) {
    case 'embedding-provider-not-configured':
      return 'Semantic search is not configured on this server, so results come from keyword matching.'
    case 'semantic-search-disabled':
      return 'Semantic search is turned off, so results come from keyword matching.'
    case 'vector-store-unavailable':
      return 'The vector index is unavailable, so results come from keyword matching.'
    case 'AI provider timed out':
      return 'The embedding provider timed out, so results come from keyword matching.'
    case 'AI provider is unreachable':
      return 'The embedding provider is unreachable, so results come from keyword matching.'
    case 'AI provider rate limit reached':
      return 'The embedding provider is rate limiting requests, so results come from keyword matching.'
    default:
      return reason
        ? 'Semantic ranking is degraded, so results fall back to keyword matching.'
        : 'Results come from keyword matching.'
  }
}

/**
 * Cited sources first, then sources that were only retrieved as context.
 * The list keeps each source's original `index` so `[S#]` markers in the answer
 * still resolve to the correct discussion.
 */
export function orderSourcesForDisplay(sources: AiSource[]): AiSource[] {
  return [...sources].sort((a, b) => {
    if (a.cited !== b.cited) return a.cited ? -1 : 1
    return a.index - b.index
  })
}
