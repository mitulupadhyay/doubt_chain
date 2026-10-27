import { vi } from 'vitest'

/**
 * In-memory Prisma double.
 *
 * Backend unit tests never touch a live PostgreSQL instance: every model method
 * used by the services under test is a `vi.fn()` that tests configure per case.
 * This keeps the suite fast, deterministic and runnable without a database
 * (including in CI where no pgvector instance is available).
 */
export type FakePrisma = ReturnType<typeof createFakePrisma>

function modelMock() {
  return {
    findUnique: vi.fn(async () => null as unknown),
    findFirst: vi.fn(async () => null as unknown),
    findMany: vi.fn(async () => [] as unknown[]),
    create: vi.fn(async () => ({}) as unknown),
    createMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => ({}) as unknown),
    upsert: vi.fn(async () => ({}) as unknown),
    delete: vi.fn(async () => ({}) as unknown),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => ({}) as unknown)
  }
}

export function createFakePrisma() {
  return {
    user: modelMock(),
    subject: modelMock(),
    doubt: modelMock(),
    answer: modelMock(),
    answerUpvote: modelMock(),
    doubtEmbedding: modelMock(),
    aiInteraction: modelMock(),
    $queryRaw: vi.fn(async () => [] as unknown[]),
    $queryRawUnsafe: vi.fn(async () => [] as unknown[]),
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(undefined)
      return Promise.all(arg as Promise<unknown>[])
    }),
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined)
  }
}

export const prismaMock = createFakePrisma()

export function resetPrismaMock(): void {
  const fresh = createFakePrisma()
  for (const key of Object.keys(fresh) as Array<keyof FakePrisma>) {
    // Mutate in place so modules holding a reference see the fresh fns.
    ;(prismaMock as Record<string, unknown>)[key as string] = fresh[key]
  }
}
