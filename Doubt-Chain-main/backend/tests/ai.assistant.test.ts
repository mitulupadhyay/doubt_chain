import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prismaMock } from './helpers/prismaMock.js'
import { signToken } from '../src/utils/jwt.js'
import { AiProviderError } from '../src/ai/errors.js'
import type { LlmProvider } from '../src/ai/llm.js'
import { askDoubtAssistant } from '../src/services/ai/assistant.js'
import { doubtRow, fakeEmbeddingProvider } from './searchFixtures.js'

const llmRef = vi.hoisted(() => ({ current: null as LlmProvider | null }))

vi.mock('../src/ai/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai/llm.js')>()
  return {
    ...actual,
    getLlmProvider: () => llmRef.current
  }
})

function fakeLlm(text: string, overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    provider: 'fake-llm',
    model: 'fake-model-1',
    complete: vi.fn(async () => ({
      text,
      provider: 'fake-llm',
      model: 'fake-model-1',
      latencyMs: 12
    })),
    ...overrides
  }
}

function failingLlm(kind: 'timeout' | 'http' | 'rate_limited'): LlmProvider {
  return {
    provider: 'fake-llm',
    model: 'fake-model-1',
    complete: vi.fn(async () => {
      throw new AiProviderError(kind, `fake ${kind}`, {
        provider: 'fake-llm',
        statusCode: kind === 'http' ? 500 : undefined
      })
    })
  }
}

function keywordDoubtRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    title: 'Why does a circular queue overflow?',
    content: 'Front and rear pointers collide after wrapping.',
    isResolved: true,
    createdAt: new Date('2026-09-10'),
    updatedAt: new Date('2026-09-10'),
    authorId: 'u1',
    subjectId: 's1',
    author: { id: 'u1', username: 'asha', displayName: 'Asha' },
    subject: { id: 's1', name: 'Data Structures', code: 'CS201' },
    _count: { answers: 2 },
    ...overrides
  }
}

const token = () => signToken({ userId: 'u1', email: 'asha@example.com' })
const auth = { Authorization: `Bearer ${token()}` }

function stubRetrieval() {
  prismaMock.$queryRawUnsafe.mockResolvedValue([doubtRow({ id: 'd1', score: 0.88 })])
  // Keyword channel fallback (used by the HTTP tests, where no embedding
  // provider is configured) resolves the same discussion.
  prismaMock.doubt.findMany.mockResolvedValue([keywordDoubtRow({ id: 'd1' })])
  prismaMock.answer.findMany.mockResolvedValue([
    {
      id: 'a1',
      doubtId: 'd1',
      content: 'Because rear + 1 == front means the queue is full.',
      createdAt: new Date('2026-09-11'),
      author: { displayName: 'Asha' },
      _count: { upvotes: 9 }
    }
  ])
}

describe('AI Doubt Assistant (RAG service)', () => {
  it('grounds the answer in retrieved discussions and cites real sources', async () => {
    stubRetrieval()
    const llm = fakeLlm('Overflow happens because `rear + 1 == front` [S1]. This is a community answer.')

    const result = await askDoubtAssistant(
      { question: 'why does my circular queue overflow', mode: 'step_by_step', userId: 'u1' },
      { llm, embeddingProvider: fakeEmbeddingProvider() }
    )

    expect(result.aiGenerated).toBe(true)
    expect(result.grounded).toBe(true)
    expect(result.insufficientContext).toBe(false)
    expect(result.mode).toBe('step_by_step')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      doubtId: 'd1',
      url: '/doubts/d1',
      cited: true,
      isResolved: true
    })
    expect(result.disclaimer).toContain('AI-generated')
    expect(result.disclaimer).toContain('not a verified answer')
    expect(result.retrieval.used).toBe(true)
    expect(result.provider).toBe('fake-llm')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(prismaMock.aiInteraction.create).toHaveBeenCalledTimes(1)
  })

  it('drops fabricated citation markers instead of inventing sources', async () => {
    stubRetrieval()
    const llm = fakeLlm('Community answer [S1]. Also see the official policy [S4].')

    const result = await askDoubtAssistant(
      { question: 'circular queue overflow', mode: 'beginner' },
      { llm, embeddingProvider: fakeEmbeddingProvider() }
    )

    expect(result.sources).toHaveLength(1)
    expect(result.sources.every((source) => source.doubtId === 'd1')).toBe(true)
    expect(result.answer).not.toContain('[S4]')
    expect(result.answer).toContain('[S1]')
  })

  it('keeps source order aligned with citation markers when only a later source is cited', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      doubtRow({ id: 'd1', title: 'Queue overflow basics', score: 0.9 }),
      doubtRow({ id: 'd2', title: 'Queue using a count variable', score: 0.72 })
    ])
    prismaMock.doubt.findMany.mockResolvedValue([])
    prismaMock.answer.findMany.mockResolvedValue([])
    const llm = fakeLlm('The count-based fix is described in [S2].')

    const result = await askDoubtAssistant(
      { question: 'how do I fix circular queue overflow' },
      { llm, embeddingProvider: fakeEmbeddingProvider() }
    )

    expect(result.sources.map((source) => `${source.index}:${source.doubtId}`)).toEqual(['1:d1', '2:d2'])
    expect(result.sources[0].cited).toBe(false)
    expect(result.sources[1].cited).toBe(true)
    expect(result.sources[1].url).toBe('/doubts/d2')
    expect(result.answer).toContain('[S2]')
  })

  it('says the context is insufficient when nothing is retrieved', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([])
    prismaMock.doubt.findMany.mockResolvedValue([])
    const llm = fakeLlm('General explanation only, no community source.')

    const result = await askDoubtAssistant(
      { question: 'what is a quantum annealer used for' },
      { llm, embeddingProvider: fakeEmbeddingProvider() }
    )

    expect(result.grounded).toBe(false)
    expect(result.insufficientContext).toBe(true)
    expect(result.sources).toEqual([])
    expect(result.disclaimer).toContain('No relevant community discussion was found')
  })

  it('exposes degraded retrieval without blocking the answer', async () => {
    const brokenProvider = {
      provider: 'fake',
      model: 'fake-embed-4',
      dimensions: 4,
      embed: vi.fn(async () => {
        throw new AiProviderError('timeout', 'embed timed out', { provider: 'fake' })
      })
    }
    prismaMock.doubt.findMany.mockResolvedValue([keywordDoubtRow()])
    prismaMock.answer.findMany.mockResolvedValue([])
    const llm = fakeLlm('Keyword-only retrieval still gave context [S1].')

    const result = await askDoubtAssistant(
      { question: 'circular queue overflow' },
      { llm, embeddingProvider: brokenProvider }
    )

    expect(result.retrieval.degraded).toBe(true)
    expect(result.retrieval.degradedReason).toBe('AI provider timed out')
    expect(result.sources).toHaveLength(1)
    expect(result.disclaimer).toContain('retrieval was degraded')
  })

  it('uses the doubt content when asked about an existing discussion', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue({
      id: 'd1',
      title: 'Why does a circular queue overflow?',
      content: 'Front and rear pointers collide.',
      subjectId: 's1',
      subject: { id: 's1', name: 'Data Structures', code: 'CS201' }
    })
    prismaMock.$queryRawUnsafe.mockResolvedValue([])
    prismaMock.doubt.findMany.mockResolvedValue([])
    const llm = fakeLlm('A clear beginner explanation.')

    const result = await askDoubtAssistant(
      { doubtId: 'd1', question: '', mode: 'beginner' },
      { llm, embeddingProvider: fakeEmbeddingProvider() }
    )

    expect(result.answer).toBe('A clear beginner explanation.')
    expect(llm.complete).toHaveBeenCalledTimes(1)
    const messages = (llm.complete as unknown as { mock: { calls: Array<[Array<{ content: string }>]> } }).mock
      .calls[0][0]
    expect(messages[1].content).toContain('Why does a circular queue overflow?')
    // The doubt being explained must not be cited back as its own source.
    expect(result.sources.find((source) => source.doubtId === 'd1')).toBeUndefined()
  })

  it('throws a 404 for an unknown doubt', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(null)
    await expect(
      askDoubtAssistant({ doubtId: 'missing', mode: 'beginner' }, { llm: fakeLlm('x') })
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses to answer when no LLM is configured (no mock answers)', async () => {
    await expect(
      askDoubtAssistant({ question: 'why does my queue overflow' }, { llm: null })
    ).rejects.toMatchObject({ kind: 'not_configured' })
    expect(prismaMock.aiInteraction.create).not.toHaveBeenCalled()
  })
})

describe('AI assistant HTTP contract', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/v1/ai/ask').send({ question: 'why is my queue overflowing' })
    expect(res.status).toBe(401)
  })

  it('rejects invalid input with 400', async () => {
    llmRef.current = fakeLlm('x')
    const res = await request(app)
      .post('/api/v1/ai/ask')
      .set(auth)
      .send({ question: 'hi' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('rejects an unknown explanation mode', async () => {
    llmRef.current = fakeLlm('x')
    const res = await request(app)
      .post('/api/v1/ai/ask')
      .set(auth)
      .send({ question: 'why is my queue overflowing', mode: 'pirate' })
    expect(res.status).toBe(400)
  })

  it('returns the grounded answer with sources over HTTP', async () => {
    llmRef.current = fakeLlm('Because rear+1 == front [S1].')
    stubRetrieval()

    const res = await request(app)
      .post('/api/v1/ai/ask')
      .set(auth)
      .send({ question: 'why does my circular queue overflow', mode: 'hinglish' })

    expect(res.status).toBe(200)
    expect(res.body.data.aiGenerated).toBe(true)
    expect(res.body.data.sources[0].url).toBe('/doubts/d1')
  })

  it('returns 503 when the AI provider is not configured', async () => {
    llmRef.current = null
    const res = await request(app)
      .post('/api/v1/ai/ask')
      .set(auth)
      .send({ question: 'why does my circular queue overflow' })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED')
  })

  it('returns 504 when the provider times out', async () => {
    llmRef.current = failingLlm('timeout')
    const res = await request(app)
      .post('/api/v1/ai/ask')
      .set(auth)
      .send({ question: 'why does my circular queue overflow' })
    expect(res.status).toBe(504)
    expect(res.body.error.code).toBe('AI_TIMEOUT')
  })

  it('returns 503 when the provider errors', async () => {
    llmRef.current = failingLlm('http')
    const res = await request(app)
      .post('/api/v1/ai/ask')
      .set(auth)
      .send({ question: 'why does my circular queue overflow' })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AI_UNAVAILABLE')
  })

  it('returns 429 when the provider rate limits', async () => {
    llmRef.current = failingLlm('rate_limited')
    const res = await request(app)
      .post('/api/v1/ai/ask')
      .set(auth)
      .send({ question: 'why does my circular queue overflow' })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('AI_PROVIDER_RATE_LIMITED')
  })

  it('answers a doubt-scoped question and 404s for a missing doubt', async () => {
    llmRef.current = fakeLlm('Step 1 ... Step 2 ...')
    prismaMock.doubt.findUnique.mockResolvedValue({
      id: 'd1',
      title: 'Why does a circular queue overflow?',
      content: 'Pointers collide.',
      subjectId: 's1',
      subject: { id: 's1', name: 'Data Structures', code: 'CS201' }
    })
    prismaMock.$queryRawUnsafe.mockResolvedValue([])
    prismaMock.doubt.findMany.mockResolvedValue([])

    const ok = await request(app).post('/api/v1/ai/doubts/d1/ask').set(auth).send({ mode: 'step_by_step' })
    expect(ok.status).toBe(200)
    expect(ok.body.data.mode).toBe('step_by_step')

    prismaMock.doubt.findUnique.mockResolvedValue(null)
    const missing = await request(app).post('/api/v1/ai/doubts/nope/ask').set(auth).send({})
    expect(missing.status).toBe(404)
  })

  it('exposes a secret-free capability report', async () => {
    const res = await request(app).get('/api/v1/ai/config')
    expect(res.status).toBe(200)
    expect(res.body.data.assistantConfigured).toBe(false)
    expect(res.body.data.modes).toHaveLength(5)
    expect(JSON.stringify(res.body)).not.toMatch(/api[_-]?key/i)
    expect(JSON.stringify(res.body)).not.toContain('sk-')
  })
})
