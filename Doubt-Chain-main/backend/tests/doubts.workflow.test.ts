import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prismaMock } from './helpers/prismaMock.js'
import { signToken } from '../src/utils/jwt.js'
import {
  createDoubt,
  listDoubts,
  getDoubtById,
  updateDoubt,
  resolveDoubt,
  searchDoubts,
  listFaq
} from '../src/services/doubt.service.js'
import {
  createAnswer,
  listAnswers,
  updateAnswer,
  deleteAnswer,
  upvoteAnswer,
  removeUpvote
} from '../src/services/answer.service.js'

const auth = { Authorization: `Bearer ${signToken({ userId: 'owner-1', email: 'owner@example.com' })}` }

function createdDoubt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    title: 'Queue overflow',
    content: 'Why?',
    authorId: 'owner-1',
    subjectId: 's1',
    isResolved: false,
    resolvedAt: null,
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    author: { id: 'owner-1', username: 'owner', displayName: 'Owner' },
    subject: { id: 's1', name: 'Data Structures', code: 'CS201' },
    _count: { answers: 0 },
    ...overrides
  }
}

describe('Doubt workflows (regression)', () => {
  it('rejects a doubt with an unknown subject', async () => {
    prismaMock.subject.findUnique.mockResolvedValue(null)
    await expect(
      createDoubt({ title: 'Queue overflow', content: 'Why?', subjectId: 'missing', authorId: 'u1' })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.doubt.create).not.toHaveBeenCalled()
  })

  it('creates a doubt and does not block on embedding indexing', async () => {
    prismaMock.subject.findUnique.mockResolvedValue({ id: 's1' })
    prismaMock.doubt.create.mockResolvedValue(createdDoubt())

    const result = await createDoubt({
      title: 'Queue overflow',
      content: 'Why?',
      subjectId: 's1',
      authorId: 'owner-1'
    })

    expect(result.id).toBe('d1')
    expect(prismaMock.doubt.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.doubtEmbedding.upsert).not.toHaveBeenCalled()
  })

  it('lists doubts with pagination metadata and filters', async () => {
    prismaMock.doubt.findMany.mockResolvedValue([createdDoubt()])
    prismaMock.doubt.count.mockResolvedValue(1)

    const result = await listDoubts({ subjectId: 's1', isResolved: false, page: 1, limit: 10 })

    expect(result.total).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(prismaMock.doubt.findMany.mock.calls[0][0].where).toMatchObject({
      subjectId: 's1',
      isResolved: false
    })
  })

  it('returns 404 for a missing doubt', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(null)
    await expect(getDoubtById('missing')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('prevents non-owners from editing a doubt', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(createdDoubt())
    await expect(updateDoubt('d1', 'someone-else', { title: 'Hijacked' })).rejects.toMatchObject({
      statusCode: 403
    })
    expect(prismaMock.doubt.update).not.toHaveBeenCalled()
  })

  it('lets the owner edit a doubt and strips protected fields', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(createdDoubt())
    prismaMock.doubt.update.mockResolvedValue(createdDoubt({ title: 'Updated' }))

    await updateDoubt('d1', 'owner-1', {
      title: 'Updated',
      isResolved: true,
      resolvedAt: new Date(),
      authorId: 'attacker',
      subjectId: 's2'
    })

    const data = prismaMock.doubt.update.mock.calls[0][0].data
    expect(data).toEqual({ title: 'Updated' })
  })

  it('only the owner can resolve, and resolving stamps resolvedAt', async () => {
    prismaMock.doubt.findUnique
      .mockResolvedValueOnce(createdDoubt())
      .mockResolvedValueOnce(createdDoubt())
    await expect(resolveDoubt('d1', 'someone-else')).rejects.toMatchObject({ statusCode: 403 })

    prismaMock.doubt.update.mockResolvedValue(createdDoubt({ isResolved: true, resolvedAt: new Date() }))
    const resolved = await resolveDoubt('d1', 'owner-1')
    expect(resolved.isResolved).toBe(true)
    expect(prismaMock.doubt.update.mock.calls[0][0].data).toMatchObject({ isResolved: true })
    expect(prismaMock.doubt.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date)
  })

  it('is idempotent when resolving an already resolved doubt', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(createdDoubt({ isResolved: true }))
    await resolveDoubt('d1', 'owner-1')
    expect(prismaMock.doubt.update).not.toHaveBeenCalled()
  })

  it('keyword search still works and returns empty for blank queries', async () => {
    await expect(searchDoubts({ q: '   ' })).resolves.toMatchObject({ items: [], total: 0 })

    prismaMock.doubt.findMany.mockResolvedValue([createdDoubt()])
    prismaMock.doubt.count.mockResolvedValue(1)
    const result = await searchDoubts({ q: 'queue' })
    expect(result.items).toHaveLength(1)
    expect(prismaMock.doubt.findMany.mock.calls[0][0].where.OR).toHaveLength(2)
  })

  it('FAQ list only includes resolved doubts', async () => {
    prismaMock.doubt.findMany.mockResolvedValue([createdDoubt({ isResolved: true })])
    prismaMock.doubt.count.mockResolvedValue(1)

    await listFaq({ q: 'queue' })
    expect(prismaMock.doubt.findMany.mock.calls[0][0].where.isResolved).toBe(true)
  })
})

describe('Answer workflows (regression)', () => {
  it('rejects an answer on a missing doubt', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(null)
    await expect(
      createAnswer({ doubtId: 'missing', authorId: 'u1', content: 'hi' })
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('creates an answer for an existing doubt', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(createdDoubt())
    prismaMock.answer.create.mockResolvedValue({
      id: 'a1',
      doubtId: 'd1',
      authorId: 'u2',
      content: 'Because ...',
      _count: { upvotes: 0 }
    })

    const answer = await createAnswer({ doubtId: 'd1', authorId: 'u2', content: 'Because ...' })
    expect(answer.id).toBe('a1')
    expect(prismaMock.answer.create).toHaveBeenCalledTimes(1)
  })

  it('lists answers and 404s for a missing doubt', async () => {
    prismaMock.doubt.findUnique.mockResolvedValue(null)
    await expect(listAnswers('missing')).rejects.toMatchObject({ statusCode: 404 })

    prismaMock.doubt.findUnique.mockResolvedValue(createdDoubt())
    prismaMock.answer.findMany.mockResolvedValue([])
    await expect(listAnswers('d1')).resolves.toEqual([])
  })

  it('enforces answer ownership on edit and delete', async () => {
    prismaMock.answer.findUnique.mockResolvedValue({ id: 'a1', authorId: 'u2', doubtId: 'd1' })
    await expect(updateAnswer('a1', 'u3', { content: 'x' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(deleteAnswer('a1', 'u3')).rejects.toMatchObject({ statusCode: 403 })
    expect(prismaMock.answer.delete).not.toHaveBeenCalled()
  })

  it('allows the answer author to update it', async () => {
    prismaMock.answer.findUnique.mockResolvedValue({ id: 'a1', authorId: 'u2', doubtId: 'd1' })
    prismaMock.answer.update.mockResolvedValue({ id: 'a1', doubtId: 'd1', content: 'better' })

    const updated = await updateAnswer('a1', 'u2', { content: 'better' })
    expect(updated.content).toBe('better')
    expect(prismaMock.answer.update.mock.calls[0][0].data).toEqual({ content: 'better' })
  })

  it('rejects duplicate upvotes with 409 and missing upvotes with 404', async () => {
    prismaMock.answer.findUnique.mockResolvedValue({ id: 'a1', authorId: 'u2', doubtId: 'd1' })
    prismaMock.answerUpvote.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    await expect(upvoteAnswer('a1', 'u1')).rejects.toMatchObject({ statusCode: 409 })

    prismaMock.answerUpvote.delete.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2025' }))
    await expect(removeUpvote('a1', 'u1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('records an upvote', async () => {
    prismaMock.answer.findUnique.mockResolvedValue({ id: 'a1', authorId: 'u2', doubtId: 'd1' })
    prismaMock.answerUpvote.create.mockResolvedValue({ id: 'v1' })
    prismaMock.answer.findUnique.mockResolvedValueOnce({ id: 'a1', authorId: 'u2', doubtId: 'd1' })
    prismaMock.answer.findUnique.mockResolvedValueOnce({ id: 'a1', _count: { upvotes: 3 } })

    const answer = await upvoteAnswer('a1', 'u1')
    expect(answer._count.upvotes).toBe(3)
  })
})

describe('Existing HTTP endpoints and access control', () => {
  it('requires authentication to create a doubt', async () => {
    const res = await request(app)
      .post('/api/v1/doubts')
      .send({ title: 'Queue overflow', content: 'Why?', subjectId: 's1' })
    expect(res.status).toBe(401)
  })

  it('validates a new doubt payload', async () => {
    const res = await request(app).post('/api/v1/doubts').set(auth).send({ title: 'x' })
    expect(res.status).toBe(400)
  })

  it('keeps the legacy keyword search endpoint working', async () => {
    prismaMock.doubt.findMany.mockResolvedValue([])
    prismaMock.doubt.count.mockResolvedValue(0)
    const res = await request(app).get('/api/v1/doubts/search?q=queue')
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(0)
  })

  it('keeps the FAQ endpoint working', async () => {
    prismaMock.doubt.findMany.mockResolvedValue([])
    prismaMock.doubt.count.mockResolvedValue(0)
    const res = await request(app).get('/api/v1/faq')
    expect(res.status).toBe(200)
    expect(res.body.data.items).toEqual([])
  })

  it('returns 403 when a non-owner edits an answer', async () => {
    prismaMock.answer.findUnique.mockResolvedValue({ id: 'a1', authorId: 'someone-else', doubtId: 'd1' })
    const res = await request(app)
      .patch('/api/v1/answers/a1')
      .set(auth)
      .send({ content: 'hijack' })
    expect(res.status).toBe(403)
  })

  it('requires authentication for AI indexing backfill', async () => {
    const res = await request(app).post('/api/v1/ai/index/backfill').send({})
    expect(res.status).toBe(401)
  })

  it('reports 503 for backfill when embeddings are not configured', async () => {
    const res = await request(app).post('/api/v1/ai/index/backfill').set(auth).send({ limit: 5 })
    expect(res.status).toBe(503)
  })
})
