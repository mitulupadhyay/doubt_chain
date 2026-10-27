import { api } from '../lib/apiClient'
import { AiAnswer, AiConfig, ExplanationMode } from '../types/api'

export type AskAiInput = {
  question: string
  mode?: ExplanationMode
  subjectId?: string
  doubtId?: string
  topK?: number
}

export type BackfillResult = {
  indexed: number
  skipped: number
  failed: number
  remaining: number
  disabled: boolean
  failures: Array<{ doubtId: string; status: string; reason?: string }>
}

/**
 * AI Doubt Assistant API client.
 *
 * All provider credentials stay on the backend: the browser only ever sees the
 * generated answer, its sources and a capability report.
 */
export const aiService = {
  getConfig: () => api.get<AiConfig>('/ai/config'),
  ask: (input: AskAiInput) => api.post<AiAnswer>('/ai/ask', input),
  askAboutDoubt: (doubtId: string, input: { mode?: ExplanationMode; question?: string }) =>
    api.post<AiAnswer>(`/ai/doubts/${doubtId}/ask`, input),
  backfillIndex: (limit?: number) =>
    api.post<BackfillResult>('/ai/index/backfill', limit ? { limit } : {})
}
