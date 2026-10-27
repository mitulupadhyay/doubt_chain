import { z } from 'zod'

const pageSchema = z.coerce.number().int().min(1).optional()
const limitSchema = z.coerce.number().int().min(1).max(50).optional()
const minScoreSchema = z.coerce.number().min(0).max(1).optional()
const subjectIdSchema = z.string().trim().min(1).max(64).optional()

export const semanticSearchQuerySchema = z.object({
  query: z.object({
    q: z.string().trim().min(3).max(500),
    subjectId: subjectIdSchema,
    isResolved: z.enum(['true', 'false']).optional(),
    page: pageSchema,
    limit: limitSchema,
    minScore: minScoreSchema
  })
})

export const similarDoubtsQuerySchema = z.object({
  query: z.object({
    q: z.string().trim().min(3).max(500),
    subjectId: subjectIdSchema,
    excludeDoubtId: z.string().trim().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(10).optional(),
    minScore: minScoreSchema
  })
})
