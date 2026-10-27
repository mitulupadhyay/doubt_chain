import { beforeEach, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from './helpers/prismaMock.js'

/**
 * Replace the Prisma client with the in-memory double before any application
 * module is imported. The real `@prisma/client` runtime is still used for type
 * helpers (e.g. SQL template tags), but no engine binary is loaded and no
 * database connection is attempted.
 */
vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>()
  return {
    ...actual,
    PrismaClient: function PrismaClientMock() {
      return prismaMock
    }
  }
})

beforeEach(() => {
  resetPrismaMock()
  vi.restoreAllMocks()
})
