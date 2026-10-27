import { z } from 'zod'
import { EXPLANATION_MODES } from '../services/ai/modes.js'

const modeSchema = z.enum(EXPLANATION_MODES)
const topKSchema = z.coerce.number().int().min(1).max(8).optional()
const questionSchema = z.string().trim().min(8, 'Question must be at least 8 characters').max(4000)

export const askAiSchema = z.object({
  body: z.object({
    question: questionSchema,
    mode: modeSchema.optional(),
    subjectId: z.string().trim().min(1).max(64).optional(),
    doubtId: z.string().trim().min(1).max(64).optional(),
    topK: topKSchema
  })
})

export const askDoubtAiSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1)
  }),
  body: z
    .object({
      mode: modeSchema.optional(),
      question: questionSchema.optional(),
      topK: topKSchema
    })
    .optional()
    .default({})
})

export const backfillSchema = z.object({
  body: z
    .object({
      limit: z.coerce.number().int().min(1).max(50).optional()
    })
    .optional()
    .default({})
})
