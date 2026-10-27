import crypto from 'node:crypto'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import {
  EmbeddingProvider,
  embedText,
  getEmbeddingProvider,
  toVectorLiteral
} from '../../ai/embedding.js'
import { AiProviderError, describeAiError, isAiProviderError } from '../../ai/errors.js'

export type IndexStatus = 'indexed' | 'skipped' | 'failed' | 'disabled'

export type IndexOutcome = {
  doubtId: string
  status: IndexStatus
  model?: string
  provider?: string
  contentHash?: string
  reason?: string
}

export type IndexableDoubt = {
  id: string
  title: string
  content: string
  subject?: { name: string; code: string } | null
  answers?: Array<{ content: string; _count?: { upvotes: number } }>
}

const MAX_DOCUMENT_CHARS = 6000
const MAX_ANSWERS = 3
const MAX_ANSWER_CHARS = 1200

/**
 * Build the text that gets embedded for a doubt.
 *
 * Answer content is included because resolved community answers carry the
 * vocabulary students actually search with. Everything is truncated so a single
 * huge doubt cannot blow up the embedding request (and its cost).
 */
export function buildEmbeddingContent(doubt: IndexableDoubt): string {
  const answers = [...(doubt.answers ?? [])]
    .sort((a, b) => (b._count?.upvotes ?? 0) - (a._count?.upvotes ?? 0))
    .slice(0, MAX_ANSWERS)
    .map((answer) => answer.content.trim().slice(0, MAX_ANSWER_CHARS))
    .filter(Boolean)

  const subject = doubt.subject ? `${doubt.subject.name} (${doubt.subject.code})` : ''
  const parts = [doubt.title.trim(), subject, doubt.content.trim(), ...answers].filter(Boolean)
  return parts.join('\n\n').slice(0, MAX_DOCUMENT_CHARS)
}

export function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/** SQLSTATE codes that indicate the vector store is missing/unusable. */
const VECTOR_STORE_ERROR_CODES = new Set(['42P01', '42704', '42883', '42703', '42P07'])

function isVectorStoreError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  if (code && VECTOR_STORE_ERROR_CODES.has(code)) return true
  const message = error instanceof Error ? error.message : ''
  return /vector|DoubtEmbedding|extension/i.test(message) && /does not exist|unknown|not found/i.test(message)
}

export async function indexDoubtEmbedding(
  doubtId: string,
  deps: { provider?: EmbeddingProvider | null } = {}
): Promise<IndexOutcome> {
  const provider = deps.provider === undefined ? getEmbeddingProvider() : deps.provider
  if (!provider) {
    return { doubtId, status: 'disabled', reason: 'embedding-provider-not-configured' }
  }

  try {
    const doubt = await prisma.doubt.findUnique({
      where: { id: doubtId },
      include: {
        subject: { select: { name: true, code: true } },
        answers: {
          select: { content: true, _count: { select: { upvotes: true } } }
        }
      }
    })
    if (!doubt) {
      return { doubtId, status: 'failed', reason: 'doubt-not-found' }
    }

    const text = buildEmbeddingContent(doubt as IndexableDoubt)
    const hash = contentHash(text)

    const existing = await prisma.doubtEmbedding.findUnique({ where: { doubtId } })
    if (
      existing &&
      existing.contentHash === hash &&
      existing.model === provider.model &&
      existing.provider === provider.provider &&
      existing.dimensions === provider.dimensions
    ) {
      return {
        doubtId,
        status: 'skipped',
        model: existing.model,
        provider: existing.provider,
        contentHash: existing.contentHash
      }
    }

    const embedded = await embedText(text, provider)
    const literal = toVectorLiteral(embedded.vector)

    await prisma.doubtEmbedding.upsert({
      where: { doubtId },
      create: {
        doubtId,
        provider: embedded.provider,
        model: embedded.model,
        dimensions: embedded.dimensions,
        contentHash: hash
      },
      update: {
        provider: embedded.provider,
        model: embedded.model,
        dimensions: embedded.dimensions,
        contentHash: hash
      }
    })

    // `embedding` is a pgvector Unsupported column, so it is written with raw SQL.
    // The vector is passed as a bound parameter, never string-interpolated.
    await prisma.$executeRawUnsafe(
      'UPDATE "DoubtEmbedding" SET "embedding" = $1::vector, "updatedAt" = NOW() WHERE "doubtId" = $2',
      literal,
      doubtId
    )

    return {
      doubtId,
      status: 'indexed',
      model: embedded.model,
      provider: embedded.provider,
      contentHash: hash
    }
  } catch (error) {
    if (isAiProviderError(error)) {
      return { doubtId, status: 'failed', reason: describeAiError(error) }
    }
    if (isVectorStoreError(error)) {
      return { doubtId, status: 'failed', reason: 'vector-store-unavailable' }
    }
    return {
      doubtId,
      status: 'failed',
      reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown-error'
    }
  }
}

/**
 * Fire-and-forget index refresh used by doubt/answer workflows.
 *
 * Indexing must never make posting a doubt or answer fail, so every error is
 * swallowed after logging. When no provider is configured the call is a no-op.
 */
export function scheduleDoubtIndexing(doubtId: string): void {
  if (!env.EMBEDDING_AUTO_INDEX || !doubtId) return
  if (!getEmbeddingProvider()) return

  void indexDoubtEmbedding(doubtId)
    .then((outcome) => {
      if (outcome.status === 'failed') {
        console.warn(`[embeddings] indexing ${doubtId} failed: ${outcome.reason}`)
      }
    })
    .catch((error: unknown) => {
      console.warn(
        `[embeddings] indexing ${doubtId} threw: ${error instanceof AiProviderError ? error.message : 'unknown error'}`
      )
    })
}

/**
 * Ids of doubts that still need a vector.
 *
 * The raw query also catches rows whose `DoubtEmbedding.embedding` column is
 * NULL (a failed write), which a Prisma relation filter cannot express. When the
 * vector table does not exist yet, fall back to the relation filter.
 */
async function findPendingDoubtIds(limit: number): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT d."id" FROM "Doubt" d
       LEFT JOIN "DoubtEmbedding" e ON e."doubtId" = d."id"
       WHERE e."embedding" IS NULL
       ORDER BY d."createdAt" DESC
       LIMIT $1`,
      limit
    )
    return (rows ?? []).map((row) => row.id)
  } catch {
    const rows = await prisma.doubt.findMany({
      where: { embedding: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true }
    })
    return (rows ?? []).map((row) => row.id)
  }
}

async function countPendingDoubts(): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*)::int AS "count" FROM "Doubt" d
       LEFT JOIN "DoubtEmbedding" e ON e."doubtId" = d."id"
       WHERE e."embedding" IS NULL`
    )
    const value = rows?.[0]?.count
    return typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  } catch {
    return prisma.doubt.count({ where: { embedding: null } })
  }
}

export async function indexPendingDoubts(input: {
  limit?: number
  provider?: EmbeddingProvider | null
} = {}): Promise<{
  indexed: number
  skipped: number
  failed: number
  remaining: number
  disabled: boolean
  failures: IndexOutcome[]
}> {
  const provider = input.provider === undefined ? getEmbeddingProvider() : input.provider
  if (!provider) {
    return { indexed: 0, skipped: 0, failed: 0, remaining: 0, disabled: true, failures: [] }
  }

  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)
  const pendingIds = await findPendingDoubtIds(limit)

  let indexed = 0
  let skipped = 0
  const failures: IndexOutcome[] = []
  for (const id of pendingIds) {
    const outcome = await indexDoubtEmbedding(id, { provider })
    if (outcome.status === 'indexed') indexed += 1
    else if (outcome.status === 'skipped') skipped += 1
    else failures.push(outcome)
  }

  const remaining = await countPendingDoubts()
  return { indexed, skipped, failed: failures.length, remaining, disabled: false, failures }
}

export async function embeddingCoverage(): Promise<{ indexed: number; total: number }> {
  try {
    const [indexed, total] = await Promise.all([
      prisma.doubtEmbedding.count(),
      prisma.doubt.count()
    ])
    return { indexed, total }
  } catch {
    return { indexed: 0, total: 0 }
  }
}
