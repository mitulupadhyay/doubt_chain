import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value))

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(1).optional(),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Generic per-IP budget for all API routes. Raised from 100 in Phase 4 because
  // search-as-you-type + AI requests (which have their own limits) would
  // otherwise exhaust the shared campus-NAT budget.
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(10000).default(300),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // ── AI: embeddings (semantic search / RAG retrieval) ──────────────
  // Provider is inferred from EMBEDDING_PROVIDER, and is only active when a
  // key is present. Secret values never leave the backend.
  EMBEDDING_PROVIDER: z.enum(['openai', 'gemini', 'huggingface']).optional(),
  EMBEDDING_API_KEY: optionalString,
  EMBEDDING_BASE_URL: optionalString,
  EMBEDDING_MODEL: optionalString,
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(4096).default(1536),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(64).default(16),

  // ── AI: generative model (AI Doubt Assistant / RAG answers) ───────
  LLM_PROVIDER: z.enum(['openai', 'gemini', 'groq']).optional(),
  LLM_API_KEY: optionalString,
  LLM_BASE_URL: optionalString,
  LLM_MODEL: optionalString,
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4096).default(900),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),

  // ── AI: retrieval + safety knobs ───────────────────────────────────
  AI_MAX_CONTEXT_DOUBTS: z.coerce.number().int().min(1).max(10).default(5),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(10),
  SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(300).default(60),
  SEMANTIC_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.25),
  SEMANTIC_SIMILAR_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.45),
  SEMANTIC_SEARCH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  EMBEDDING_AUTO_INDEX: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true')
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')
  throw new Error(`Invalid environment configuration: ${issues}`)
}

export const env = parsed.data
