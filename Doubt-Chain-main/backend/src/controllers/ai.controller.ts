import { Response } from 'express'
import { AuthRequest } from '../middleware/auth.js'
import { ok } from '../utils/http.js'
import { HttpError } from '../middleware/errorHandler.js'
import { askDoubtAssistant } from '../services/ai/assistant.js'
import { listModes, resolveMode } from '../services/ai/modes.js'
import { aiCapabilityStatus } from '../ai/config.js'
import { env } from '../config/env.js'
import { indexPendingDoubts } from '../services/search/embeddingIndex.js'
import { isAiProviderError } from '../ai/errors.js'

/** Map provider failures to explicit HTTP errors — never to a fabricated answer. */
function respondProviderError(res: Response, error: unknown): boolean {
  if (!isAiProviderError(error)) return false

  if (error.kind === 'not_configured') {
    res.status(503).json({
      success: false,
      message:
        'The AI assistant is not configured on this server. Add an LLM API key to the backend environment to enable it.',
      error: { code: 'AI_NOT_CONFIGURED' }
    })
    return true
  }

  if (error.kind === 'timeout') {
    res.status(504).json({
      success: false,
      message: 'The AI provider timed out while generating an answer. Please try again.',
      error: { code: 'AI_TIMEOUT' }
    })
    return true
  }

  if (error.kind === 'rate_limited') {
    res.status(429).json({
      success: false,
      message: 'The AI provider is rate limiting requests right now. Please retry shortly.',
      error: { code: 'AI_PROVIDER_RATE_LIMITED' }
    })
    return true
  }

  res.status(503).json({
    success: false,
    message: 'The AI provider is currently unavailable. Please try again later.',
    error: { code: 'AI_UNAVAILABLE', kind: error.kind }
  })
  return true
}

export async function ask(req: AuthRequest, res: Response) {
  try {
    const answer = await askDoubtAssistant({
      question: req.body.question,
      mode: req.body.mode,
      subjectId: req.body.subjectId,
      doubtId: req.body.doubtId,
      topK: req.body.topK,
      userId: req.user!.userId
    })
    res.json(ok(answer, 'AI answer generated'))
  } catch (error) {
    if (respondProviderError(res, error)) return
    throw error
  }
}

export async function askAboutDoubt(req: AuthRequest, res: Response) {
  try {
    const answer = await askDoubtAssistant({
      doubtId: req.params.id,
      question: req.body?.question ?? '',
      mode: req.body?.mode,
      topK: req.body?.topK,
      userId: req.user!.userId
    })
    res.json(ok(answer, 'AI answer generated'))
  } catch (error) {
    if (respondProviderError(res, error)) return
    throw error
  }
}

export async function config(_req: AuthRequest, res: Response) {
  const status = aiCapabilityStatus()
  res.json(
    ok({
      ...status,
      modes: listModes(),
      defaultMode: resolveMode(undefined),
      limits: {
        maxQuestionLength: 4000,
        maxContextDoubts: env.AI_MAX_CONTEXT_DOUBTS,
        aiRequestsPerMinute: env.AI_RATE_LIMIT_PER_MINUTE
      }
    })
  )
}

export async function backfill(req: AuthRequest, res: Response) {
  const limit = req.body?.limit as number | undefined
  const result = await indexPendingDoubts({ limit })
  if (result.disabled) {
    throw new HttpError(
      503,
      'Embedding provider is not configured, so there is nothing to index. Set EMBEDDING_API_KEY on the backend.'
    )
  }
  res.json(ok(result, 'Embedding backfill completed'))
}
