import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { signToken } from '../src/utils/jwt.js'

const userA = `Bearer ${signToken({ userId: 'rate-user-a', email: 'a@example.com' })}`
const userB = `Bearer ${signToken({ userId: 'rate-user-b', email: 'b@example.com' })}`

const originalAiLimit = process.env.AI_RATE_LIMIT_PER_MINUTE
const originalSearchLimit = process.env.SEARCH_RATE_LIMIT_PER_MINUTE

afterAll(() => {
  if (originalAiLimit === undefined) delete process.env.AI_RATE_LIMIT_PER_MINUTE
  else process.env.AI_RATE_LIMIT_PER_MINUTE = originalAiLimit

  if (originalSearchLimit === undefined) delete process.env.SEARCH_RATE_LIMIT_PER_MINUTE
  else process.env.SEARCH_RATE_LIMIT_PER_MINUTE = originalSearchLimit
})

describe('AI endpoint rate limiting', () => {
  it('limits each user independently and returns a structured 429', async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = '2'

    const body = { question: 'why does my circular queue overflow' }
    const first = await request(app).post('/api/v1/ai/ask').set('Authorization', userA).send(body)
    const second = await request(app).post('/api/v1/ai/ask').set('Authorization', userA).send(body)
    const third = await request(app).post('/api/v1/ai/ask').set('Authorization', userA).send(body)

    // The assistant is not configured in tests, so allowed calls report 503 —
    // what matters is that they were not rate limited.
    expect(first.status).not.toBe(429)
    expect(second.status).not.toBe(429)
    expect(third.status).toBe(429)
    expect(third.body.success).toBe(false)
    expect(third.body.error.code).toBe('AI_RATE_LIMITED')
    expect(third.headers['ratelimit-policy']).toBeDefined()

    // A different student is unaffected by user A's bucket.
    const otherUser = await request(app).post('/api/v1/ai/ask').set('Authorization', userB).send(body)
    expect(otherUser.status).not.toBe(429)
  })

  it('requires authentication before consuming the AI rate limit', async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = '1'
    const unauth = await request(app)
      .post('/api/v1/ai/ask')
      .send({ question: 'why does my circular queue overflow' })
    expect(unauth.status).toBe(401)
  })
})

describe('Search endpoint rate limiting', () => {
  it('throttles semantic search callers with a structured 429', async () => {
    process.env.SEARCH_RATE_LIMIT_PER_MINUTE = '2'

    const first = await request(app).get('/api/v1/search/similar?q=circular%20queue')
    const second = await request(app).get('/api/v1/search/similar?q=circular%20queue')
    const third = await request(app).get('/api/v1/search/similar?q=circular%20queue')

    expect(first.status).not.toBe(429)
    expect(second.status).not.toBe(429)
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('SEARCH_RATE_LIMITED')
  })
})
