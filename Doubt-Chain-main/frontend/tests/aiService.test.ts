import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { aiService } from '../src/services/aiService'
import { doubtService } from '../src/services/doubtService'

function mockFetch(payload: unknown, status = 200) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify({ success: status < 400, message: 'OK', data: payload }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('AI service client', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('posts questions to the AI endpoint with credentials', async () => {
    const spy = mockFetch({ answer: 'Because...' })
    await aiService.ask({ question: 'why queue overflow', mode: 'step_by_step' })

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/ai/ask')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ question: 'why queue overflow', mode: 'step_by_step' })
  })

  it('targets the doubt-scoped endpoint', async () => {
    const spy = mockFetch({ answer: 'ok' })
    await aiService.askAboutDoubt('d1', { mode: 'hinglish' })
    expect((spy.mock.calls[0] as unknown as [string])[0]).toContain('/ai/doubts/d1/ask')
  })

  it('surfaces backend error messages (e.g. not configured)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            message: 'The AI assistant is not configured on this server.',
            error: { code: 'AI_NOT_CONFIGURED' }
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )

    await expect(aiService.ask({ question: 'why queue overflow' })).rejects.toMatchObject({
      message: expect.stringContaining('not configured')
    })
  })
})

describe('Semantic search client', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('serialises semantic search filters into the query string', async () => {
    const spy = mockFetch({ items: [] })
    await doubtService.semanticSearch('circular queue', {
      subjectId: 's1',
      isResolved: true,
      page: 2,
      limit: 5
    })

    const url = (spy.mock.calls[0] as unknown as [string])[0]
    expect(url).toContain('/search/semantic?')
    expect(url).toContain('q=circular+queue')
    expect(url).toContain('subjectId=s1')
    expect(url).toContain('isResolved=true')
    expect(url).toContain('page=2')
    expect(url).toContain('limit=5')
  })

  it('omits unset filters and encodes multilingual queries', async () => {
    const spy = mockFetch({ items: [] })
    await doubtService.findSimilar('सर्कुलर क्यू क्यों भरा है', { limit: 3 })

    const url = (spy.mock.calls[0] as unknown as [string])[0]
    expect(url).toContain('/search/similar?')
    expect(url).not.toContain('subjectId')
    expect(url).not.toContain('excludeDoubtId')
    expect(decodeURIComponent(url.replace(/\+/g, ' '))).toContain('सर्कुलर क्यू क्यों भरा है')
  })

  it('passes excludeDoubtId when editing an existing doubt', async () => {
    const spy = mockFetch({ items: [] })
    await doubtService.findSimilar('queue overflow', { excludeDoubtId: 'd9' })
    expect((spy.mock.calls[0] as unknown as [string])[0]).toContain('excludeDoubtId=d9')
  })
})
