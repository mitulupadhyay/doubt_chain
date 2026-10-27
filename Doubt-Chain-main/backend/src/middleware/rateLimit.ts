import rateLimit from 'express-rate-limit'
import { Request } from 'express'
import { env } from '../config/env.js'
import { fail } from '../utils/http.js'

function readLimit(name: 'AI' | 'SEARCH'): number {
  const raw = name === 'AI' ? process.env.AI_RATE_LIMIT_PER_MINUTE : process.env.SEARCH_RATE_LIMIT_PER_MINUTE
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return name === 'AI' ? env.AI_RATE_LIMIT_PER_MINUTE : env.SEARCH_RATE_LIMIT_PER_MINUTE
}

function userOrIp(req: Request): string {
  const user = (req as Request & { user?: { userId?: string } }).user
  if (user?.userId) return `user:${user.userId}`
  return `ip:${req.ip ?? 'unknown'}`
}

/**
 * Per-user limiter for AI endpoints (LLM + embedding cost).
 * Requires `requireAuth` earlier in the middleware chain so the key is the user.
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => readLimit('AI'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  handler: (_req, res) => {
    res
      .status(429)
      .json(fail('Rate limit reached for AI requests. Please wait a minute and try again.', { code: 'AI_RATE_LIMITED' }))
  }
})

/** Per-user/IP limiter for semantic search + similar-question lookups. */
export const searchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => readLimit('SEARCH'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  handler: (_req, res) => {
    res
      .status(429)
      .json(fail('Rate limit reached for search requests. Please slow down.', { code: 'SEARCH_RATE_LIMITED' }))
  }
})
