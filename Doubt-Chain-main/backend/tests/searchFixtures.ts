import { vi } from 'vitest'
import { EmbeddingProvider } from '../src/ai/embedding.js'
import type { SearchDoubtRow } from '../src/services/search/semanticSearch.js'

/** Deterministic embedding provider double (4 dimensions, fixed vector). */
export function fakeEmbeddingProvider(vector = [1, 0, 0, 0]): EmbeddingProvider {
  return {
    provider: 'fake',
    model: 'fake-embed-4',
    dimensions: 4,
    embed: vi.fn(async (texts: string[]) => ({
      vectors: texts.map(() => vector),
      model: 'fake-embed-4',
      dimensions: 4,
      provider: 'fake'
    }))
  }
}

/** A pgvector row as returned by the raw similarity query. */
export function doubtRow(overrides: Partial<SearchDoubtRow> = {}): SearchDoubtRow {
  return {
    id: 'd1',
    title: 'Why does a circular queue report overflow?',
    content: 'Front and rear pointers meet when the queue is full.',
    isResolved: true,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    authorId: 'u1',
    subjectId: 's1',
    authorUsername: 'asha',
    authorDisplayName: 'Asha',
    subjectName: 'Data Structures',
    subjectCode: 'CS201',
    answerCount: 2,
    score: 0.9,
    ...overrides
  }
}
