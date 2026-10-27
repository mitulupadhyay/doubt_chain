/**
 * Backfill vector embeddings for existing doubts.
 *
 * Usage (from backend/):
 *   npm run embeddings:backfill            # index up to 50 doubts
 *   npm run embeddings:backfill -- 200     # index up to 200 doubts
 *
 * Safe to re-run: doubts whose content hash, model and provider already match
 * are skipped. Requires EMBEDDING_API_KEY and a migrated database with pgvector.
 */
import { aiCapabilityStatus } from '../src/ai/config.js'
import { embeddingCoverage, indexPendingDoubts } from '../src/services/search/embeddingIndex.js'
import { prisma } from '../src/config/prisma.js'

async function main() {
  const requested = Number(process.argv[2] ?? 50)
  const total = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 50

  const status = aiCapabilityStatus()
  if (!status.embeddingsConfigured) {
    console.error(
      'No embedding provider configured. Set EMBEDDING_PROVIDER, EMBEDDING_API_KEY and EMBEDDING_MODEL in backend/.env.'
    )
    process.exitCode = 1
    return
  }

  console.log(`Embedding provider: ${status.embeddingsProvider} (${status.embeddingsModel})`)
  const before = await embeddingCoverage()
  console.log(`Coverage before: ${before.indexed}/${before.total}`)

  let indexed = 0
  let failed = 0
  let progress = 0
  while (progress < total) {
    const batchSize = Math.min(10, total - progress)
    const result = await indexPendingDoubts({ limit: batchSize })
    indexed += result.indexed
    failed += result.failed
    progress += batchSize
    if (result.remaining === 0 || (result.indexed === 0 && result.skipped === 0 && result.failed === 0)) break
    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        console.warn(`  failed ${failure.doubtId}: ${failure.reason}`)
      }
      if (result.failures.length === batchSize) break
    }
  }

  const after = await embeddingCoverage()
  console.log(`Indexed ${indexed} doubt(s), ${failed} failure(s).`)
  console.log(`Coverage after: ${after.indexed}/${after.total}`)
}

main()
  .catch((error: unknown) => {
    console.error('Backfill failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
