/**
 * Pure ranking helpers shared by semantic search, similar-question suggestions
 * and the RAG retriever. Keeping them pure makes ranking testable without a
 * database or an embedding provider.
 */

export type Scored<T> = { item: T; score: number }

export type MatchType = 'vector' | 'keyword' | 'hybrid'

export type MergedResult<T> = Scored<T> & {
  matchType: MatchType
  /** Raw cosine similarity from the vector channel (0 when absent). */
  vectorScore: number
  /** Raw keyword score from the keyword channel (0 when absent). */
  keywordScore: number
}

export function roundScore(score: number, precision = 4): number {
  if (!Number.isFinite(score)) return 0
  const factor = 10 ** precision
  return Math.round(score * factor) / factor
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
    normA += (a[i] ?? 0) ** 2
    normB += (b[i] ?? 0) ** 2
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Rank documents by cosine similarity to the query vector (in-memory helper). */
export function rankByCosine<T extends { vector: number[] }>(
  queryVector: number[],
  documents: T[],
  options: { minScore?: number; limit?: number } = {}
): Scored<T>[] {
  const minScore = options.minScore ?? 0
  const ranked = documents
    .map((item) => ({ item, score: cosineSimilarity(queryVector, item.vector) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
  return options.limit ? ranked.slice(0, options.limit) : ranked
}

export type KeywordScorable = { title: string; content: string }

/**
 * Explainable keyword score over synonym groups (see `expandQuery().conceptGroups`).
 * - a group matched in the title is worth 2 points, in the content 1 point
 * - a group counts once, no matter how many of its synonyms appear
 * - score is normalised by the maximum achievable points for the query
 *
 * Plain string arrays are treated as one group per string.
 */
export function keywordScore(
  document: KeywordScorable,
  query: string[] | string[][]
): { score: number; matched: string[] } {
  const groups: string[][] =
    Array.isArray(query) && query.length > 0 && Array.isArray(query[0])
      ? (query as string[][])
      : (query as string[]).map((term) => [term])

  if (groups.length === 0) return { score: 0, matched: [] }

  const title = document.title.toLowerCase()
  const content = document.content.toLowerCase()
  const matched: string[] = []
  let points = 0

  for (const group of groups) {
    const needles = group.map((term) => String(term).toLowerCase()).filter(Boolean)
    const titleMatch = needles.some((needle) => title.includes(needle))
    const contentMatch = needles.some((needle) => content.includes(needle))
    if (titleMatch || contentMatch) {
      const hit = needles.find((needle) => title.includes(needle) || content.includes(needle))
      if (hit) matched.push(hit)
    }
    points += (titleMatch ? 2 : 0) + (contentMatch ? 1 : 0)
  }

  return { score: Math.min(1, points / (groups.length * 3)), matched }
}

function normalizeScores<T>(results: Scored<T>[]): Scored<T>[] {
  const max = results.reduce((acc, entry) => Math.max(acc, entry.score), 0)
  if (max <= 0) return results.map((entry) => ({ ...entry, score: 0 }))
  return results.map((entry) => ({ ...entry, score: entry.score / max }))
}

/**
 * Merge vector and keyword result lists into one ranked list.
 *
 * Vector scores are cosine similarities (0..1); keyword scores are already
 * normalised. Both lists are re-normalised to their own maximum before the
 * weighted merge so a single very strong hit in one channel does not erase the
 * other channel's signal.
 */
export function mergeHybridResults<T extends { id: string }>(
  vectorResults: Scored<T>[],
  keywordResults: Scored<T>[],
  options: { vectorWeight?: number; keywordWeight?: number; limit?: number } = {}
): MergedResult<T>[] {
  const vectorWeight = options.vectorWeight ?? 0.75
  const keywordWeight = options.keywordWeight ?? 0.25

  const raw = new Map<string, { item: T; vectorScore: number; keywordScore: number }>()
  for (const entry of vectorResults) raw.set(entry.item.id, { item: entry.item, vectorScore: entry.score, keywordScore: 0 })
  for (const entry of keywordResults) {
    const existing = raw.get(entry.item.id)
    if (existing) existing.keywordScore = Math.max(existing.keywordScore, entry.score)
    else raw.set(entry.item.id, { item: entry.item, vectorScore: 0, keywordScore: entry.score })
  }

  const normalizedVector = new Map(normalizeScores([...raw.values()].map((entry) => ({ item: entry.item, score: entry.vectorScore }))).map((entry) => [entry.item.id, entry.score]))
  const normalizedKeyword = new Map(normalizeScores([...raw.values()].map((entry) => ({ item: entry.item, score: entry.keywordScore }))).map((entry) => [entry.item.id, entry.score]))

  const merged: MergedResult<T>[] = []
  for (const [id, entry] of raw) {
    const vectorNorm = normalizedVector.get(id) ?? 0
    const keywordNorm = normalizedKeyword.get(id) ?? 0
    const score = vectorWeight * vectorNorm + keywordWeight * keywordNorm
    const matchType: MatchType =
      entry.vectorScore > 0 && entry.keywordScore > 0
        ? 'hybrid'
        : entry.vectorScore > 0
          ? 'vector'
          : 'keyword'
    merged.push({
      item: entry.item,
      score: roundScore(score),
      // The reported score stays interpretable: raw cosine similarity when the
      // vector channel matched, otherwise the keyword score.
      vectorScore: roundScore(entry.vectorScore),
      keywordScore: roundScore(entry.keywordScore),
      matchType
    })
  }

  merged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.item.id.localeCompare(b.item.id)
  })

  return options.limit ? merged.slice(0, options.limit) : merged
}

/** Deterministic pagination helper for already-ranked lists. */
export function paginate<T>(results: T[], page: number, limit: number): T[] {
  const safePage = Math.max(1, page)
  const safeLimit = Math.max(1, limit)
  return results.slice((safePage - 1) * safeLimit, safePage * safeLimit)
}
