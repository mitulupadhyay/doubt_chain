import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prismaMock } from './helpers/prismaMock.js'
import { AiProviderError } from '../src/ai/errors.js'
import { cosineSimilarity, rankByCosine, mergeHybridResults } from '../src/services/search/similarity.js'
import {
  buildKeywordWhere,
  buildVectorSearchQuery,
  semanticSearchDoubts
} from '../src/services/search/semanticSearch.js'
import { EmbeddingProvider } from '../src/ai/embedding.js'
import { doubtRow, fakeEmbeddingProvider } from './searchFixtures.js'

describe('pgvector query builder', () => {
  it('binds every value as a parameter and never interpolates query text', () => {
    const query = buildVectorSearchQuery({
      vectorLiteral: '[1,0,0,0]',
      model: 'fake-embed-4',
      provider: 'fake',
      filters: { subjectId: 's1', isResolved: true },
      minScore: 0.3,
      limit: 10,
      offset: 20
    })

    expect(query.params).toEqual(['[1,0,0,0]', 'fake-embed-4', 'fake', 's1', true, 0.3, 10, 20])
    expect(query.sql).toContain('$1::vector')
    expect(query.sql).toContain('d."subjectId" = $4')
    expect(query.sql).toContain('d."isResolved" = $5')
    expect(query.sql).toContain('LIMIT $7 OFFSET $8')
    expect(query.sql).toContain('ORDER BY e."embedding" <=> $1::vector')
    // No user content is ever concatenated into the SQL string.
    expect(query.sql).not.toContain('s1')
  })

  it('omits optional filters when not supplied', () => {
    const query = buildVectorSearchQuery({
      vectorLiteral: '[1,0]',
      model: 'm',
      provider: 'p',
      limit: 5
    })
    expect(query.sql).not.toContain('d."subjectId" =')
    expect(query.sql).not.toContain('d."isResolved" =')
    expect(query.sql).toContain('LIMIT $4 OFFSET $5')
  })

  it('builds keyword filters for both title and content', () => {
    const where = buildKeywordWhere(['queue', 'overflow'], { subjectId: 's1' }) as {
      OR: unknown[]
      subjectId: string
    }
    expect(where.OR).toHaveLength(4)
    expect(where.subjectId).toBe('s1')
    expect(buildKeywordWhere(['a'])).toBeNull()

    // Concept groups are flattened exactly like the scoring path.
    const grouped = buildKeywordWhere([['queue', 'क्यू'], ['overflow']]) as { OR: unknown[] }
    expect(grouped.OR).toHaveLength(6)
  })
})

describe('Similarity ranking', () => {
  it('computes cosine similarity between vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
    expect(cosineSimilarity([], [1])).toBe(0)
  })

  it('ranks the most relevant document first and honours the threshold', () => {
    const ranked = rankByCosine(
      [1, 0, 0],
      [
        { id: 'unrelated', vector: [0, 1, 0] },
        { id: 'close', vector: [0.95, 0.05, 0] },
        { id: 'exact', vector: [1, 0, 0] }
      ],
      { minScore: 0.5, limit: 2 }
    )
    expect(ranked.map((entry) => entry.item.id)).toEqual(['exact', 'close'])
    expect(ranked[0].score).toBeCloseTo(1)
  })

  it('fuses vector and keyword channels without duplicates', () => {
    const vector = [
      { item: { id: 'a' }, score: 0.9 },
      { item: { id: 'b' }, score: 0.4 }
    ]
    const keyword = [
      { item: { id: 'a' }, score: 0.8 },
      { item: { id: 'c' }, score: 0.6 }
    ]
    const merged = mergeHybridResults(vector, keyword, { limit: 3 })
    expect(merged.map((entry) => entry.item.id)).toEqual(['a', 'b', 'c'])
    expect(merged[0].matchType).toBe('hybrid')
    expect(merged[1].matchType).toBe('vector')
    expect(merged[2].matchType).toBe('keyword')
    expect(new Set(merged.map((entry) => entry.item.id)).size).toBe(merged.length)
  })
})

describe('Semantic search service', () => {
  it('returns hybrid ranked results with source metadata and scores', async () => {
    const provider = fakeEmbeddingProvider()
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      doubtRow({ id: 'vector-top', score: 0.91, title: 'Queue overflow explained' }),
      doubtRow({ id: 'vector-second', score: 0.55, title: 'Circular queue implementation' })
    ])
    prismaMock.doubt.findMany.mockResolvedValue([
      {
        id: 'keyword-only',
        title: 'Queue overflow in C',
        content: 'Overflow happens when the queue is full.',
        isResolved: false,
        createdAt: new Date('2026-09-01'),
        updatedAt: new Date('2026-09-01'),
        authorId: 'u2',
        subjectId: 's1',
        author: { id: 'u2', username: 'ravi', displayName: 'Ravi' },
        subject: { id: 's1', name: 'Data Structures', code: 'CS201' },
        _count: { answers: 0 }
      }
    ])

    const result = await semanticSearchDoubts(
      { q: 'circular queue overflow', page: 1, limit: 10 },
      { provider }
    )

    expect(result.mode).toBe('hybrid')
    expect(result.degraded).toBe(false)
    expect(result.language).toBe('en')
    expect(result.items.map((item) => item.id)).toEqual(['vector-top', 'vector-second', 'keyword-only'])
    expect(result.items[0].score).toBeGreaterThan(result.items[1].score)
    expect(result.items[0].matchType).toBe('vector')
    expect(result.items[2].matchType).toBe('keyword')
    expect(result.items[0].subject.name).toBe('Data Structures')
    expect(result.items[0]._count.answers).toBe(2)
    expect(result.scores.topScore).toBeGreaterThan(0.9)
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(1)
  })

  it('paginates ranked results', async () => {
    const provider = fakeEmbeddingProvider()
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      doubtRow({ id: 'a', score: 0.9 }),
      doubtRow({ id: 'b', score: 0.6 }),
      doubtRow({ id: 'c', score: 0.4 })
    ])

    const page2 = await semanticSearchDoubts({ q: 'queue overflow', page: 2, limit: 2 }, { provider })
    expect(page2.items.map((item) => item.id)).toEqual(['c'])
    expect(page2.total).toBe(3)
    expect(page2.totalPages).toBe(2)
  })

  it('passes the configured score threshold to the vector query', async () => {
    const provider = fakeEmbeddingProvider()
    prismaMock.$queryRawUnsafe.mockResolvedValue([])

    await semanticSearchDoubts({ q: 'queue overflow', minScore: 0.42 }, { provider })

    const params = prismaMock.$queryRawUnsafe.mock.calls[0].slice(1)
    expect(params).toContain(0.42)
  })

  it('falls back to keyword search and reports degradation when the provider times out', async () => {
    const provider: EmbeddingProvider = {
      provider: 'fake',
      model: 'fake-embed-4',
      dimensions: 4,
      embed: vi.fn(async () => {
        throw new AiProviderError('timeout', 'upstream timed out', { provider: 'fake' })
      })
    }
    prismaMock.doubt.findMany.mockResolvedValue([
      {
        id: 'keyword-hit',
        title: 'Circular queue overflow',
        content: 'Why does overflow happen?',
        isResolved: true,
        createdAt: new Date('2026-09-02'),
        updatedAt: new Date('2026-09-02'),
        authorId: 'u1',
        subjectId: 's1',
        author: { id: 'u1', username: 'asha', displayName: 'Asha' },
        subject: { id: 's1', name: 'Data Structures', code: 'CS201' },
        _count: { answers: 1 }
      }
    ])

    const result = await semanticSearchDoubts({ q: 'circular queue overflow' }, { provider })

    expect(result.mode).toBe('keyword')
    expect(result.degraded).toBe(true)
    expect(result.degradedReason).toBe('AI provider timed out')
    expect(result.items.map((item) => item.id)).toEqual(['keyword-hit'])
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('degrades when the pgvector store is missing instead of throwing', async () => {
    const provider = fakeEmbeddingProvider()
    prismaMock.$queryRawUnsafe.mockRejectedValue(
      Object.assign(new Error('relation "DoubtEmbedding" does not exist'), { code: '42P01' })
    )

    const result = await semanticSearchDoubts({ q: 'queue overflow' }, { provider })

    expect(result.degraded).toBe(true)
    expect(result.degradedReason).toBe('vector-store-unavailable')
    expect(result.mode).toBe('keyword')
  })

  it('reports missing embedding configuration explicitly', async () => {
    const result = await semanticSearchDoubts({ q: 'queue overflow' }, { provider: null })
    expect(result.degraded).toBe(true)
    expect(result.degradedReason).toBe('embedding-provider-not-configured')
    expect(result.mode).toBe('keyword')
  })
})

describe('Semantic search API', () => {
  it('rejects queries shorter than 3 characters', async () => {
    const res = await request(app).get('/api/v1/search/semantic?q=ab')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('returns a degraded keyword response when no embedding provider is configured', async () => {
    const res = await request(app).get('/api/v1/search/semantic?q=circular%20queue')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.degraded).toBe(true)
    expect(res.body.data.degradedReason).toBe('embedding-provider-not-configured')
    expect(res.body.data.language).toBe('en')
    expect(Array.isArray(res.body.data.items)).toBe(true)
  })

  it('rejects an invalid limit', async () => {
    const res = await request(app).get('/api/v1/search/semantic?q=queue&limit=500')
    expect(res.status).toBe(400)
  })
})
