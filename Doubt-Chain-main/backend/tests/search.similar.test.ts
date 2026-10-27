import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prismaMock } from './helpers/prismaMock.js'
import { AiProviderError } from '../src/ai/errors.js'
import { EmbeddingProvider } from '../src/ai/embedding.js'
import { findSimilarDoubts } from '../src/services/search/semanticSearch.js'
import { doubtRow, fakeEmbeddingProvider } from './searchFixtures.js'

function keywordDoubt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    title: 'Circular queue overflow in C',
    content: 'Queue shows overflow because rear+1 wraps to front.',
    isResolved: true,
    createdAt: new Date('2026-09-10'),
    updatedAt: new Date('2026-09-10'),
    authorId: 'u2',
    subjectId: 's1',
    author: { id: 'u2', username: 'ravi', displayName: 'Ravi' },
    subject: { id: 's1', name: 'Data Structures', code: 'CS201' },
    _count: { answers: 3 },
    ...overrides
  }
}

describe('Similar question suggestions', () => {
  it('ranks existing discussions before the student posts', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      doubtRow({ id: 'existing-1', title: 'Queue overflow', score: 0.93 }),
      doubtRow({ id: 'existing-2', title: 'Queue underflow', score: 0.61 })
    ])
    prismaMock.doubt.findMany.mockResolvedValue([keywordDoubt({ id: 'existing-3' })])

    const result = await findSimilarDoubts(
      { q: 'why does my circular queue overflow', limit: 5 },
      { provider: fakeEmbeddingProvider() }
    )

    expect(result.items.map((item) => item.id)).toEqual(['existing-1', 'existing-2', 'existing-3'])
    expect(result.items[0].score).toBeCloseTo(0.93, 2)
    expect(result.language).toBe('en')
    expect(result.degraded).toBe(false)
    expect(result.hasStrongMatch).toBe(true)
    expect(result.items[0].title).toBeTruthy()
  })

  it('never suggests the doubt currently being edited', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      doubtRow({ id: 'current', score: 0.99 }),
      doubtRow({ id: 'other', score: 0.7 })
    ])
    prismaMock.doubt.findMany.mockResolvedValue([])

    const result = await findSimilarDoubts(
      { q: 'circular queue overflow', excludeDoubtId: 'current' },
      { provider: fakeEmbeddingProvider() }
    )

    expect(result.items.map((item) => item.id)).toEqual(['other'])
  })

  it('respects the requested limit', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) =>
        doubtRow({ id: `d${index}`, score: 0.9 - index * 0.05 })
      )
    )
    prismaMock.doubt.findMany.mockResolvedValue([])

    const result = await findSimilarDoubts({ q: 'queue overflow', limit: 3 }, { provider: fakeEmbeddingProvider() })
    expect(result.items).toHaveLength(3)
  })

  it('still returns keyword suggestions when the embedding provider fails (never blocks posting)', async () => {
    const provider: EmbeddingProvider = {
      provider: 'fake',
      model: 'fake-embed-4',
      dimensions: 4,
      embed: vi.fn(async () => {
        throw new AiProviderError('network', 'connection reset', { provider: 'fake' })
      })
    }
    prismaMock.doubt.findMany.mockResolvedValue([keywordDoubt({ id: 'keyword-hit' })])

    const result = await findSimilarDoubts({ q: 'circular queue overflow' }, { provider })

    expect(result.degraded).toBe(true)
    expect(result.degradedReason).toBe('AI provider is unreachable')
    expect(result.items.map((item) => item.id)).toEqual(['keyword-hit'])
    expect(result.hasStrongMatch).toBe(true)
  })

  it('returns an empty, non-throwing result when nothing matches', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([])
    prismaMock.doubt.findMany.mockResolvedValue([])

    const result = await findSimilarDoubts({ q: 'quantum tunnelling in diodes' }, { provider: fakeEmbeddingProvider() })
    expect(result.items).toEqual([])
    expect(result.hasStrongMatch).toBe(false)
  })

  it('marks weak vector-only matches as not strong', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([doubtRow({ id: 'loose', score: 0.46, isResolved: false })])
    prismaMock.doubt.findMany.mockResolvedValue([])

    const result = await findSimilarDoubts({ q: 'queue', minScore: 0.4 }, { provider: fakeEmbeddingProvider() })
    expect(result.items).toHaveLength(1)
    expect(result.hasStrongMatch).toBe(false)
  })

  it('validates the query before hitting the database', async () => {
    const res = await request(app).get('/api/v1/search/similar?q=ab')
    expect(res.status).toBe(400)
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('serves suggestions over HTTP', async () => {
    prismaMock.doubt.findMany.mockResolvedValue([keywordDoubt({ id: 'http-hit' })])
    const res = await request(app).get('/api/v1/search/similar?q=circular+queue+overflow')
    expect(res.status).toBe(200)
    expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual(['http-hit'])
    expect(res.body.data.degraded).toBe(true)
  })
})
