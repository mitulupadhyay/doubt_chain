import { api } from '../lib/apiClient'
import {
  Answer,
  Doubt,
  Paginated,
  SemanticSearchResponse,
  SimilarDoubtsResponse,
  Subject
} from '../types/api'

export const doubtService = {
  listSubjects: () => api.get<Subject[]>('/subjects'),
  getSubject: (id: string) => api.get<Subject>(`/subjects/${id}`),
  listDoubts: (params?: { subjectId?: string; isResolved?: boolean; page?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.subjectId) qs.set('subjectId', params.subjectId)
    if (typeof params?.isResolved === 'boolean') qs.set('isResolved', String(params.isResolved))
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return api.get<Paginated<Doubt>>(`/doubts${q ? `?${q}` : ''}`)
  },
  searchDoubts: (q: string, params?: { subjectId?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams({ q })
    if (params?.subjectId) qs.set('subjectId', params.subjectId)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    return api.get<Paginated<Doubt>>(`/doubts/search?${qs.toString()}`)
  },
  /**
   * Semantic (pgvector) search with keyword-hybrid fallback.
   * The response reports `degraded` + `degradedReason` when embeddings are
   * unavailable so the UI can tell the student the truth.
   */
  semanticSearch: (
    q: string,
    params?: { subjectId?: string; isResolved?: boolean; page?: number; limit?: number; minScore?: number }
  ) => {
    const qs = new URLSearchParams({ q })
    if (params?.subjectId) qs.set('subjectId', params.subjectId)
    if (typeof params?.isResolved === 'boolean') qs.set('isResolved', String(params.isResolved))
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    if (typeof params?.minScore === 'number') qs.set('minScore', String(params.minScore))
    return api.get<SemanticSearchResponse>(`/search/semantic?${qs.toString()}`)
  },
  /** Existing discussions similar to a question that is being written. */
  findSimilar: (
    q: string,
    params?: { subjectId?: string; excludeDoubtId?: string; limit?: number }
  ) => {
    const qs = new URLSearchParams({ q })
    if (params?.subjectId) qs.set('subjectId', params.subjectId)
    if (params?.excludeDoubtId) qs.set('excludeDoubtId', params.excludeDoubtId)
    if (params?.limit) qs.set('limit', String(params.limit))
    return api.get<SimilarDoubtsResponse>(`/search/similar?${qs.toString()}`)
  },
  getDoubt: (id: string) => api.get<Doubt>(`/doubts/${id}`),
  createDoubt: (data: { title: string; content: string; subjectId: string; mediaUrl?: string; mediaType?: 'IMAGE' | 'AUDIO' }) => api.post<Doubt>('/doubts', data),
  updateDoubt: (id: string, data: Partial<Doubt>) => api.patch<Doubt>(`/doubts/${id}`, data),
  resolveDoubt: (id: string) => api.post<Doubt>(`/doubts/${id}/resolve`),
  listAnswers: (doubtId: string) => api.get<Answer[]>(`/doubts/${doubtId}/answers`),
  createAnswer: (doubtId: string, data: { content: string; mediaUrl?: string; mediaType?: 'IMAGE' | 'AUDIO' }) => api.post<Answer>(`/doubts/${doubtId}/answers`, data),
  updateAnswer: (answerId: string, data: Partial<Answer>) => api.patch<Answer>(`/answers/${answerId}`, data),
  deleteAnswer: (answerId: string) => api.delete<{ deleted: boolean }>(`/answers/${answerId}`),
  upvoteAnswer: (answerId: string) => api.post<Answer>(`/answers/${answerId}/upvote`),
  removeUpvote: (answerId: string) => api.delete<Answer>(`/answers/${answerId}/upvote`),
  listFaq: (params?: { subjectId?: string; q?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.subjectId) qs.set('subjectId', params.subjectId)
    if (params?.q) qs.set('q', params.q)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return api.get<Paginated<Doubt>>(`/faq${q ? `?${q}` : ''}`)
  }
}
