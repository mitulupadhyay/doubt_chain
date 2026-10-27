export type ApiResponse<T = unknown> = {
  success: boolean
  message: string
  data?: T
  error?: unknown
}

export type User = {
  id: string
  email: string
  username: string
  displayName: string
  fullName?: string | null
  profession?: 'STUDENT' | 'PROFESSOR' | 'CORPORATE_WORKER' | null
  identificationNumber?: string | null
  createdAt: string
}

export type Subject = {
  id: string
  name: string
  code: string
  description?: string | null
  createdAt: string
  updatedAt: string
}

export type Author = {
  id: string
  username: string
  displayName: string
}

export type Doubt = {
  id: string
  title: string
  content: string
  mediaUrl?: string | null
  mediaType?: 'IMAGE' | 'AUDIO' | null
  isResolved: boolean
  resolvedAt?: string | null
  createdAt: string
  updatedAt: string
  authorId: string
  subjectId: string
  author?: Author
  subject?: Subject
  _count?: { answers: number }
  answers?: Answer[]
}

export type Answer = {
  id: string
  content: string
  mediaUrl?: string | null
  mediaType?: 'IMAGE' | 'AUDIO' | null
  createdAt: string
  updatedAt: string
  authorId: string
  doubtId: string
  author?: Author
  _count?: { upvotes: number }
}

export type Paginated<T> = {
  items: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

// ── Phase 4: semantic search + AI assistant ─────────────────────────

export type SearchMatchType = 'vector' | 'keyword' | 'hybrid'
export type QueryLanguage = 'en' | 'hi' | 'hinglish'

/** A doubt enriched with retrieval metadata (semantic / similar results). */
export type SearchResultDoubt = Doubt & {
  score: number
  matchType: SearchMatchType
}

export type SemanticSearchResponse = {
  items: SearchResultDoubt[]
  page: number
  limit: number
  total: number
  totalPages: number
  mode: 'semantic' | 'hybrid' | 'keyword'
  degraded: boolean
  degradedReason?: string
  language: QueryLanguage
  normalizedQuery: string
  expandedTerms: string[]
  glosses: string[]
  scores: { minScore: number; topScore: number | null }
  candidateWindow: number
}

export type SimilarDoubtsResponse = {
  items: SearchResultDoubt[]
  degraded: boolean
  degradedReason?: string
  language: QueryLanguage
  hasStrongMatch: boolean
}

export type ExplanationMode =
  | 'beginner'
  | 'step_by_step'
  | 'simple_example'
  | 'hinglish'
  | 'debug_code'

export type ExplanationModeInfo = {
  id: ExplanationMode
  label: string
  description: string
}

export type AiSource = {
  /** 1-based citation marker index used by the answer (`[S1]` → 1). */
  index: number
  doubtId: string
  title: string
  url: string
  snippet: string
  score: number
  isResolved: boolean
  answerCount: number
  cited: boolean
}

export type AiAnswer = {
  answer: string
  mode: ExplanationMode
  modeLabel: string
  aiGenerated: true
  grounded: boolean
  insufficientContext: boolean
  sources: AiSource[]
  disclaimer: string
  language: QueryLanguage
  retrieval: {
    used: boolean
    degraded: boolean
    degradedReason?: string
    topScore: number | null
    retrieved: number
  }
  provider: string
  model: string
  latencyMs: number
  generatedAt: string
}

export type AiConfig = {
  embeddingsConfigured: boolean
  embeddingsProvider: string | null
  embeddingsModel: string | null
  embeddingsDimensions: number | null
  assistantConfigured: boolean
  assistantProvider: string | null
  assistantModel: string | null
  semanticSearchEnabled: boolean
  autoIndexingEnabled: boolean
  modes: ExplanationModeInfo[]
  defaultMode: ExplanationMode
  limits: { maxQuestionLength: number; maxContextDoubts: number }
}
