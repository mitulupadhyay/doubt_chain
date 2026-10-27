import { Response } from 'express'
import { AuthRequest } from '../middleware/auth.js'
import { ok } from '../utils/http.js'
import { findSimilarDoubts, semanticSearchDoubts } from '../services/search/semanticSearch.js'

export async function semantic(req: AuthRequest, res: Response) {
  const { q, subjectId, isResolved, page, limit, minScore } = req.query as unknown as {
    q: string
    subjectId?: string
    isResolved?: 'true' | 'false'
    page?: number
    limit?: number
    minScore?: number
  }

  const result = await semanticSearchDoubts({
    q,
    subjectId,
    isResolved: isResolved === 'true' ? true : isResolved === 'false' ? false : undefined,
    page,
    limit,
    minScore
  })

  res.json(ok(result))
}

export async function similar(req: AuthRequest, res: Response) {
  const { q, subjectId, excludeDoubtId, limit, minScore } = req.query as unknown as {
    q: string
    subjectId?: string
    excludeDoubtId?: string
    limit?: number
    minScore?: number
  }

  const result = await findSimilarDoubts({ q, subjectId, excludeDoubtId, limit, minScore })
  res.json(ok(result))
}
