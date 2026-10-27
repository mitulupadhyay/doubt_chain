import { Router } from 'express'
import { ask, askAboutDoubt, backfill, config } from '../controllers/ai.controller.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { askAiSchema, askDoubtAiSchema, backfillSchema } from '../validators/ai.js'
import { aiRateLimiter, searchRateLimiter } from '../middleware/rateLimit.js'
import { asyncWrap } from '../utils/asyncWrap.js'

const router = Router()

// Capability report for the UI: no secrets, only booleans + model names.
router.get('/config', asyncWrap(config))

router.post('/ask', requireAuth, aiRateLimiter, validate(askAiSchema), asyncWrap(ask))
router.post(
  '/doubts/:id/ask',
  requireAuth,
  aiRateLimiter,
  validate(askDoubtAiSchema),
  asyncWrap(askAboutDoubt)
)

// Populate the vector index for doubts created before embeddings were enabled.
router.post('/index/backfill', requireAuth, searchRateLimiter, validate(backfillSchema), asyncWrap(backfill))

export default router
