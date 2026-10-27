import { Router } from 'express'
import { semantic, similar } from '../controllers/search.controller.js'
import { optionalAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { semanticSearchQuerySchema, similarDoubtsQuerySchema } from '../validators/search.js'
import { searchRateLimiter } from '../middleware/rateLimit.js'
import { asyncWrap } from '../utils/asyncWrap.js'

const router = Router()

router.get('/semantic', optionalAuth, searchRateLimiter, validate(semanticSearchQuerySchema), asyncWrap(semantic))
router.get('/similar', optionalAuth, searchRateLimiter, validate(similarDoubtsQuerySchema), asyncWrap(similar))

export default router
