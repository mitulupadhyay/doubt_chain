import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import {
  EmbeddingProvider,
  embedText,
  getEmbeddingProvider,
  toVectorLiteral
} from '../../ai/embedding.js'
import { describeAiError } from '../../ai/errors.js'
import { expandQuery, ExpandedQuery } from './text.js'
import {
  MergedResult,
  Scored,
  mergeHybridResults,
  paginate,
  roundScore,
  keywordScore
} from './similarity.js'

export type SearchFilters = {
  subjectId?: string
  isResolved?: boolean
}

export type SearchDoubtRow = {
  id: string
  title: string
  content: string
  isResolved: boolean
  createdAt: Date
  updatedAt: Date
  authorId: string
  subjectId: string
  authorUsername: string | null
  authorDisplayName: string | null
  subjectName: string | null
  subjectCode: string | null
  answerCount: number | bigint
  score?: number
}

export type SemanticSearchItem = {
  id: string
  title: string
  content: string
  isResolved: boolean
  createdAt: Date
  updatedAt: Date
  authorId: string
  subjectId: string
  author: { id: string; username: string; displayName: string }
  subject: { id: string; name: string; code: string }
  _count: { answers: number }
  score: number
  matchType: 'vector' | 'keyword' | 'hybrid'
}

export type SearchMode = 'semantic' | 'hybrid' | 'keyword'

export type SemanticSearchResponse = {
  items: SemanticSearchItem[]
  page: number
  limit: number
  total: number
  totalPages: number
  mode: SearchMode
  degraded: boolean
  degradedReason?: string
  language: ExpandedQuery['language']
  normalizedQuery: string
  expandedTerms: string[]
  glosses: string[]
  scores: { minScore: number; topScore: number | null }
  candidateWindow: number
}

export type SimilarDoubtsResponse = {
  items: SemanticSearchItem[]
  degraded: boolean
  degradedReason?: string
  language: ExpandedQuery['language']
  hasStrongMatch: boolean
}

/** Upper bound on candidates considered for hybrid fusion (documented in API response). */
export const CANDIDATE_WINDOW = 100

const MAX_KEYWORD_TERMS = 12

export type VectorQuery = { sql: string; params: unknown[] }

/**
 * Build the pgvector similarity query.
 *
 * Every user-controlled value is passed as a bound parameter ($n). Only the
 * fixed filter fragments and the model/provider names are interpolated as
 * placeholders — never raw user input.
 */
export function buildVectorSearchQuery(input: {
  vectorLiteral: string
  model: string
  provider: string
  filters?: SearchFilters
  minScore?: number
  limit: number
  offset?: number
}): VectorQuery {
  const params: unknown[] = [input.vectorLiteral, input.model, input.provider]
  const where: string[] = [
    'e."embedding" IS NOT NULL',
    'e."model" = $2',
    'e."provider" = $3'
  ]

  if (input.filters?.subjectId) {
    params.push(input.filters.subjectId)
    where.push(`d."subjectId" = $${params.length}`)
  }
  if (typeof input.filters?.isResolved === 'boolean') {
    params.push(input.filters.isResolved)
    where.push(`d."isResolved" = $${params.length}`)
  }
  if (typeof input.minScore === 'number' && input.minScore > 0) {
    params.push(input.minScore)
    where.push(`(1 - (e."embedding" <=> $1::vector)) >= $${params.length}`)
  }

  params.push(input.limit)
  const limitPlaceholder = `$${params.length}`
  const offset = Math.max(0, input.offset ?? 0)
  params.push(offset)
  const offsetPlaceholder = `$${params.length}`

  const sql = `
    SELECT
      d."id", d."title", d."content", d."isResolved", d."createdAt", d."updatedAt",
      d."authorId", d."subjectId",
      u."username" AS "authorUsername", u."displayName" AS "authorDisplayName",
      s."name" AS "subjectName", s."code" AS "subjectCode",
      (SELECT COUNT(*)::int FROM "Answer" a WHERE a."doubtId" = d."id") AS "answerCount",
      (1 - (e."embedding" <=> $1::vector))::float8 AS "score"
    FROM "DoubtEmbedding" e
    JOIN "Doubt" d ON d."id" = e."doubtId"
    JOIN "User" u ON u."id" = d."authorId"
    JOIN "Subject" s ON s."id" = d."subjectId"
    WHERE ${where.join(' AND ')}
    ORDER BY e."embedding" <=> $1::vector
    LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
  `

  return { sql, params }
}

/**
 * Build the keyword-candidate filter (used for hybrid fusion and as fallback).
 *
 * Accepts either flat terms or concept groups; groups are capped consistently
 * with scoring so recall and the score denominator describe the same query.
 */
export function buildKeywordWhere(
  terms: string[] | string[][],
  filters: SearchFilters = {}
): Record<string, unknown> | null {
  const groups: string[][] =
    terms.length > 0 && Array.isArray(terms[0]) ? (terms as string[][]) : (terms as string[]).map((term) => [term])

  const usable = groups
    .slice(0, MAX_KEYWORD_TERMS)
    .flat()
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)

  if (usable.length === 0) return null

  const where: Record<string, unknown> = {
    OR: usable.flatMap((term) => [
      { title: { contains: term, mode: 'insensitive' } },
      { content: { contains: term, mode: 'insensitive' } }
    ])
  }
  if (filters.subjectId) where.subjectId = filters.subjectId
  if (typeof filters.isResolved === 'boolean') where.isResolved = filters.isResolved
  return where
}

function toNumber(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  return typeof value === 'number' ? value : 0
}

export function mapRow(row: SearchDoubtRow, score: number, matchType: SemanticSearchItem['matchType']): SemanticSearchItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isResolved: row.isResolved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    authorId: row.authorId,
    subjectId: row.subjectId,
    author: {
      id: row.authorId,
      username: row.authorUsername ?? '',
      displayName: row.authorDisplayName ?? 'Student'
    },
    subject: {
      id: row.subjectId,
      name: row.subjectName ?? '',
      code: row.subjectCode ?? ''
    },
    _count: { answers: toNumber(row.answerCount) },
    score: roundScore(score),
    matchType
  }
}

export type SearchDeps = { provider?: EmbeddingProvider | null }

async function keywordCandidates(
  expanded: ExpandedQuery,
  filters: SearchFilters,
  minScore: number
): Promise<Scored<SemanticSearchItem>[]> {
  const where = buildKeywordWhere(expanded.conceptGroups, filters)
  if (!where) return []

  const rows = await prisma.doubt.findMany({
    where: where as never,
    take: CANDIDATE_WINDOW,
    orderBy: [{ isResolved: 'desc' }, { createdAt: 'desc' }],
    include: {
      author: { select: { id: true, username: true, displayName: true } },
      subject: { select: { id: true, name: true, code: true } },
      _count: { select: { answers: true } }
    }
  })

  const scored: Scored<SemanticSearchItem>[] = []
  for (const row of rows) {
    const { score } = keywordScore({ title: row.title, content: row.content }, expanded.conceptGroups)
    if (score < minScore) continue
    const item: SemanticSearchItem = {
      id: row.id,
      title: row.title,
      content: row.content,
      isResolved: row.isResolved,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      authorId: row.authorId,
      subjectId: row.subjectId,
      author: row.author,
      subject: row.subject,
      _count: row._count,
      score: roundScore(score),
      matchType: 'keyword'
    }
    scored.push({ item, score: roundScore(score) })
  }
  return scored
}

async function vectorCandidates(
  expanded: ExpandedQuery,
  filters: SearchFilters,
  provider: EmbeddingProvider,
  minScore = 0
): Promise<Scored<SemanticSearchItem>[]> {
  const embedded = await embedText(expanded.embeddingText, provider)
  const query = buildVectorSearchQuery({
    vectorLiteral: toVectorLiteral(embedded.vector),
    model: embedded.model,
    provider: embedded.provider,
    filters,
    minScore,
    limit: CANDIDATE_WINDOW
  })
  const rows = await prisma.$queryRawUnsafe<SearchDoubtRow[]>(query.sql, ...query.params)
  return (rows ?? []).map((row) => {
    const score = Number(row.score ?? 0)
    return { item: mapRow(row, score, 'vector'), score: roundScore(score) }
  })
}

function hasVectorStoreError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return typeof code === 'string' && ['42P01', '42704', '42883', '42703'].includes(code)
}

/**
 * Semantic search with graceful, explicit degradation.
 *
 * - vector + keyword channels are fused (hybrid) whenever embeddings work
 * - if embeddings are unconfigured or the provider fails, keyword retrieval
 *   still runs and the response says `degraded: true` with a reason
 */
export async function semanticSearchDoubts(
  input: {
    q: string
    subjectId?: string
    isResolved?: boolean
    page?: number
    limit?: number
    minScore?: number
  },
  deps: SearchDeps = {}
): Promise<SemanticSearchResponse> {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)
  const minScore = input.minScore ?? env.SEMANTIC_MIN_SCORE
  const expanded = expandQuery(input.q)
  const filters: SearchFilters = { subjectId: input.subjectId, isResolved: input.isResolved }

  let degraded = false
  let degradedReason: string | undefined
  let vectorResults: Scored<SemanticSearchItem>[] = []
  let mode: SearchMode = 'keyword'

  const provider = deps.provider === undefined ? getEmbeddingProvider() : deps.provider

  if (!env.SEMANTIC_SEARCH_ENABLED) {
    degraded = true
    degradedReason = 'semantic-search-disabled'
  } else if (!provider) {
    degraded = true
    degradedReason = 'embedding-provider-not-configured'
  } else {
    try {
      vectorResults = await vectorCandidates(expanded, filters, provider, minScore)
      mode = 'semantic'
    } catch (error) {
      degraded = true
      degradedReason = hasVectorStoreError(error) ? 'vector-store-unavailable' : describeAiError(error)
    }
  }

  const keywordResults = await keywordCandidates(expanded, filters, 0.05)

  let ranked: MergedResult<SemanticSearchItem>[]
  if (vectorResults.length > 0) {
    ranked = mergeHybridResults(vectorResults, keywordResults, { limit: CANDIDATE_WINDOW })
    mode = keywordResults.length > 0 ? 'hybrid' : 'semantic'
  } else {
    ranked = keywordResults
      .filter((entry) => entry.score >= 0.05)
      .map((entry) => ({ ...entry, vectorScore: 0, keywordScore: roundScore(entry.score), matchType: 'keyword' as const }))
    // The semantic channel ran successfully but had no matches: that is an
    // empty result set, not a degraded one.
    mode = 'keyword'
  }

  const total = ranked.length
  const pageItems = paginate(ranked, page, limit).map((entry) => ({
    ...entry.item,
    // Report the channel-level similarity (cosine for vector matches) so the
    // number shown in the UI is interpretable, while ordering uses the fused score.
    score: roundScore(Math.max(entry.vectorScore, entry.keywordScore)),
    matchType: entry.matchType
  }))

  const bestVectorScore = ranked.reduce((best, entry) => Math.max(best, entry.vectorScore), 0)
  const bestReportedScore = ranked.reduce(
    (best, entry) => Math.max(best, entry.vectorScore, entry.keywordScore),
    0
  )

  return {
    items: pageItems,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    mode,
    degraded,
    degradedReason,
    language: expanded.language,
    normalizedQuery: expanded.normalized,
    expandedTerms: expanded.keywordTerms,
    glosses: expanded.glosses,
    scores: {
      minScore: roundScore(minScore),
      topScore:
        ranked.length > 0 ? roundScore(bestVectorScore > 0 ? bestVectorScore : bestReportedScore) : null
    },
    candidateWindow: CANDIDATE_WINDOW
  }
}

/**
 * Suggest existing discussions while a student is writing a question.
 *
 * Never blocks posting: provider/vector failures produce an empty suggestion
 * list with `degraded: true` instead of an error.
 */
export async function findSimilarDoubts(
  input: {
    q: string
    subjectId?: string
    excludeDoubtId?: string
    limit?: number
    minScore?: number
  },
  deps: SearchDeps = {}
): Promise<SimilarDoubtsResponse> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10)
  const minScore = input.minScore ?? env.SEMANTIC_SIMILAR_MIN_SCORE
  const expanded = expandQuery(input.q)
  const filters: SearchFilters = { subjectId: input.subjectId }

  const provider = deps.provider === undefined ? getEmbeddingProvider() : deps.provider
  let degraded = false
  let degradedReason: string | undefined
  let vectorResults: Scored<SemanticSearchItem>[] = []

  if (!env.SEMANTIC_SEARCH_ENABLED) {
    degraded = true
    degradedReason = 'semantic-search-disabled'
  } else if (!provider) {
    degraded = true
    degradedReason = 'embedding-provider-not-configured'
  } else {
    try {
      vectorResults = await vectorCandidates(expanded, filters, provider, minScore)
    } catch (error) {
      degraded = true
      degradedReason = hasVectorStoreError(error) ? 'vector-store-unavailable' : describeAiError(error)
    }
  }

  const keywordResults = await keywordCandidates(expanded, filters, 0.2)
  const merged = mergeHybridResults(vectorResults, keywordResults, { limit: CANDIDATE_WINDOW })
    .filter((entry) => entry.item.id !== input.excludeDoubtId)
    .slice(0, limit)
    .map((entry) => ({
      ...entry.item,
      score: roundScore(Math.max(entry.vectorScore, entry.keywordScore)),
      matchType: entry.matchType
    }))

  return {
    items: merged,
    degraded,
    degradedReason,
    language: expanded.language,
    hasStrongMatch: merged.some((item) => item.isResolved && item.score >= 0.5)
  }
}

/**
 * Retrieve grounded context for RAG: the top matching discussions plus their
 * community answers. Only data that actually exists in the database is used.
 */
export async function retrieveContextForQuestion(
  input: {
    question: string
    subjectId?: string
    excludeDoubtId?: string
    topK?: number
  },
  deps: SearchDeps = {}
): Promise<{
  doubts: SemanticSearchItem[]
  answersByDoubt: Map<string, Array<{ id: string; content: string; upvotes: number; author: string }>>
  degraded: boolean
  degradedReason?: string
  topScore: number | null
}> {
  const topK = Math.min(Math.max(input.topK ?? env.AI_MAX_CONTEXT_DOUBTS, 1), 10)
  const search = await semanticSearchDoubts(
    {
      q: input.question,
      subjectId: input.subjectId,
      page: 1,
      limit: topK + (input.excludeDoubtId ? 1 : 0)
    },
    deps
  )

  const doubts = search.items.filter((item) => item.id !== input.excludeDoubtId).slice(0, topK)
  const answersByDoubt = new Map<string, Array<{ id: string; content: string; upvotes: number; author: string }>>()

  if (doubts.length > 0) {
    const answers = await prisma.answer.findMany({
      where: { doubtId: { in: doubts.map((doubt) => doubt.id) } },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { displayName: true } },
        _count: { select: { upvotes: true } }
      }
    })
    for (const answer of answers) {
      const bucket = answersByDoubt.get(answer.doubtId) ?? []
      bucket.push({
        id: answer.id,
        content: answer.content,
        upvotes: answer._count?.upvotes ?? 0,
        author: answer.author?.displayName ?? 'Peer'
      })
      answersByDoubt.set(answer.doubtId, bucket)
    }
    for (const [doubtId, bucket] of answersByDoubt) {
      answersByDoubt.set(doubtId, bucket.sort((a, b) => b.upvotes - a.upvotes).slice(0, 3))
    }
  }

  return {
    doubts,
    answersByDoubt,
    degraded: search.degraded,
    degradedReason: search.degradedReason,
    topScore: search.scores.topScore
  }
}
