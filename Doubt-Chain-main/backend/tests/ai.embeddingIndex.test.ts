import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from './helpers/prismaMock.js'
import { AiProviderError } from '../src/ai/errors.js'
import {
  buildEmbeddingContent,
  contentHash,
  embeddingCoverage,
  indexDoubtEmbedding,
  indexPendingDoubts,
  scheduleDoubtIndexing
} from '../src/services/search/embeddingIndex.js'
import { fakeEmbeddingProvider } from './searchFixtures.js'

function doubtForIndex(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    title: 'Why does a circular queue overflow?',
    content: 'Front and rear collide.',
    subject: { name: 'Data Structures', code: 'CS201' },
    answers: [
      { content: 'Low-upvote answer', _count: { upvotes: 1 } },
      { content: 'Best answer', _count: { upvotes: 12 } }
    ],
    ...overrides
  }
}

describe('Embedding document construction', () => {
  it('includes title, subject and the top-voted answers', () => {
    const text = buildEmbeddingContent(doubtForIndex())
    expect(text).toContain('Why does a circular queue overflow?')
    expect(text).toContain('Data Structures (CS201)')
    expect(text.indexOf('Best answer')).toBeLessThan(text.indexOf('Low-upvote answer'))
  })

  it('truncates very large documents', () => {
    const text = buildEmbeddingContent({
      id: 'd1',
      title: 'T'.repeat(500),
      content: 'C'.repeat(20000)
    })
    expect(text.length).toBeLessThanOrEqual(6000)
  })

  it('produces stable content hashes', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
  })
})

describe('Embedding indexer', () => {
  it('is disabled (not an error) when no provider is configured', async () => {
    const outcome = await indexDoubtEmbedding('d1', { provider: null })
    expect(outcome.status).toBe('disabled')
    expect(prismaMock.doubt.findUnique).not.toHaveBeenCalled()
  })

  it('writes the vector as a bound parameter and records metadata', async () => {
    const provider = fakeEmbeddingProvider([0.5, 0.5, 0.5, 0.5])
    prismaMock.doubt.findUnique.mockResolvedValue(doubtForIndex())
    prismaMock.doubtEmbedding.findUnique.mockResolvedValue(null)
    prismaMock.doubtEmbedding.upsert.mockResolvedValue({})

    const outcome = await indexDoubtEmbedding('d1', { provider })

    expect(outcome.status).toBe('indexed')
    expect(outcome.model).toBe('fake-embed-4')
    expect(outcome.contentHash).toBeTruthy()

    const upsertArgs = prismaMock.doubtEmbedding.upsert.mock.calls[0][0] as {
      create: { doubtId: string; contentHash: string; model: string; dimensions: number }
    }
    expect(upsertArgs.create.doubtId).toBe('d1')
    expect(upsertArgs.create.dimensions).toBe(4)

    const rawArgs = prismaMock.$executeRawUnsafe.mock.calls[0]
    expect(String(rawArgs[0])).toContain('$1::vector')
    expect(rawArgs[1]).toBe('[0.5,0.5,0.5,0.5]')
    expect(rawArgs[2]).toBe('d1')
  })

  it('skips re-embedding when content and model are unchanged', async () => {
    const provider = fakeEmbeddingProvider()
    const doubt = doubtForIndex()
    const hash = contentHash(buildEmbeddingContent(doubt))
    prismaMock.doubt.findUnique.mockResolvedValue(doubt)
    prismaMock.doubtEmbedding.findUnique.mockResolvedValue({
      doubtId: 'd1',
      contentHash: hash,
      model: 'fake-embed-4',
      provider: 'fake',
      dimensions: 4
    })

    const outcome = await indexDoubtEmbedding('d1', { provider })

    expect(outcome.status).toBe('skipped')
    expect(provider.embed).not.toHaveBeenCalled()
    expect(prismaMock.doubtEmbedding.upsert).not.toHaveBeenCalled()
  })

  it('re-embeds when the model changes', async () => {
    const provider = fakeEmbeddingProvider()
    const doubt = doubtForIndex()
    const hash = contentHash(buildEmbeddingContent(doubt))
    prismaMock.doubt.findUnique.mockResolvedValue(doubt)
    prismaMock.doubtEmbedding.findUnique.mockResolvedValue({
      doubtId: 'd1',
      contentHash: hash,
      model: 'old-model',
      provider: 'fake',
      dimensions: 4
    })
    prismaMock.doubtEmbedding.upsert.mockResolvedValue({})

    const outcome = await indexDoubtEmbedding('d1', { provider })
    expect(outcome.status).toBe('indexed')
  })

  it('reports provider failures without throwing', async () => {
    const provider = fakeEmbeddingProvider()
    provider.embed = vi.fn(async () => {
      throw new AiProviderError('timeout', 'embed timed out', { provider: 'fake' })
    })
    prismaMock.doubt.findUnique.mockResolvedValue(doubtForIndex())
    prismaMock.doubtEmbedding.findUnique.mockResolvedValue(null)

    const outcome = await indexDoubtEmbedding('d1', { provider })
    expect(outcome.status).toBe('failed')
    expect(outcome.reason).toBe('AI provider timed out')
  })

  it('reports a missing vector store instead of crashing', async () => {
    const provider = fakeEmbeddingProvider()
    prismaMock.doubt.findUnique.mockResolvedValue(doubtForIndex())
    prismaMock.doubtEmbedding.findUnique.mockResolvedValue(null)
    prismaMock.doubtEmbedding.upsert.mockRejectedValue(
      Object.assign(new Error('relation "DoubtEmbedding" does not exist'), { code: '42P01' })
    )

    const outcome = await indexDoubtEmbedding('d1', { provider })
    expect(outcome.status).toBe('failed')
    expect(outcome.reason).toBe('vector-store-unavailable')
  })

  it('handles a deleted doubt gracefully', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(null)
    const outcome = await indexDoubtEmbedding('gone', { provider: fakeEmbeddingProvider() })
    expect(outcome.status).toBe('failed')
    expect(outcome.reason).toBe('doubt-not-found')
  })

  it('never throws from the fire-and-forget scheduler', () => {
    expect(() => scheduleDoubtIndexing('d1')).not.toThrow()
  })
})

describe('Embedding backfill', () => {
  it('returns a disabled summary when nothing is configured', async () => {
    const result = await indexPendingDoubts({ provider: null })
    expect(result.disabled).toBe(true)
    expect(result.indexed).toBe(0)
  })

  it('indexes pending doubts and reports what remains', async () => {
    const provider = fakeEmbeddingProvider()
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }])
    prismaMock.doubt.findUnique.mockResolvedValue(doubtForIndex())
    prismaMock.doubtEmbedding.findUnique.mockResolvedValueOnce({
      doubtId: 'd1',
      contentHash: contentHash(buildEmbeddingContent(doubtForIndex())),
      model: 'fake-embed-4',
      provider: 'fake',
      dimensions: 4
    })
    prismaMock.doubtEmbedding.findUnique.mockResolvedValue(null)
    prismaMock.doubtEmbedding.upsert.mockResolvedValue({})
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([{ count: 3 }])

    const result = await indexPendingDoubts({ limit: 5, provider })

    expect(result.disabled).toBe(false)
    expect(result.indexed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.remaining).toBe(3)
  })

  it('falls back to the relation filter when the vector table does not exist', async () => {
    const provider = fakeEmbeddingProvider()
    prismaMock.$queryRawUnsafe.mockRejectedValue(
      Object.assign(new Error('relation "DoubtEmbedding" does not exist'), { code: '42P01' })
    )
    prismaMock.doubt.findMany.mockResolvedValue([{ id: 'd1' }])
    prismaMock.doubt.findUnique.mockResolvedValue(doubtForIndex())
    prismaMock.doubtEmbedding.findUnique.mockResolvedValue(null)
    prismaMock.doubtEmbedding.upsert.mockResolvedValue({})
    prismaMock.doubt.count.mockResolvedValue(0)

    const result = await indexPendingDoubts({ limit: 5, provider })

    expect(result.indexed).toBe(1)
    expect(prismaMock.doubt.findMany).toHaveBeenCalled()
    expect(prismaMock.doubt.count).toHaveBeenCalled()
  })

  it('summarises coverage', async () => {
    prismaMock.doubtEmbedding.count.mockResolvedValue(7)
    prismaMock.doubt.count.mockResolvedValue(10)
    await expect(embeddingCoverage()).resolves.toEqual({ indexed: 7, total: 10 })
  })

  it('returns zero coverage when the vector table is missing', async () => {
    prismaMock.doubtEmbedding.count.mockRejectedValue(new Error('relation does not exist'))
    await expect(embeddingCoverage()).resolves.toEqual({ indexed: 0, total: 0 })
  })
})
