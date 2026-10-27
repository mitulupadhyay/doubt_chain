# Doubt-Chain

Hyper-local peer-to-peer university doubt-resolution platform (Graphite 26, PS 14). Students can search before posting, answer doubts, upvote answers, mark doubts resolved, and build a searchable subject-wise FAQ.

**Phase 4 adds AI & intelligent search:** semantic search over pgvector embeddings, a RAG-grounded AI Doubt Assistant with five explanation modes and linked sources, similar-question suggestions while posting, and English/Hindi/Hinglish query support. See [Docs/11-ai-implementation.md](Docs/11-ai-implementation.md).

## Technology Stack
- Frontend: React, Vite, TypeScript, React Router, Tailwind CSS
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL, Prisma ORM
- Validation: Zod
- Auth foundation: HTTP-only cookie/JWT foundation (configured)
- Testing: Vitest, Supertest
- AI: embedding provider (OpenAI-compatible / Gemini / Hugging Face) + LLM (OpenAI-compatible / Gemini / Groq), pgvector for vector similarity
- Media: Cloudinary (integration planned for later phase)

## Directory Structure
```
Doubt-Chain/
├── Docs/        # Product requirements and innovation docs
├── frontend/    # React + Vite app
├── backend/     # Express + TypeScript API
└── README.md
```

## Prerequisites
- Node.js 18+ (tested with v24.11.0)
- npm 9+
- PostgreSQL **with the `pgvector` extension** (required for semantic search/RAG;
  typecheck/build/tests do not need a database)
- Optional: an embedding provider key and an LLM key to activate AI features

## Environment Setup
1. Copy example env files:
   - `backend/.env.example` -> `backend/.env`
   - `frontend/.env.example` -> `frontend/.env`
2. Fill required values. Never commit real secrets.

## Installation
From repo root:
```bash
cd frontend && npm install
cd ../backend && npm install
```

## Database Setup
```bash
cd backend
npx prisma validate
npx prisma generate
# Create/apply migrations only if DATABASE_URL is configured and DB is available
npx prisma migrate deploy      # applies init + pgvector + semantic-search migrations
npx prisma db seed             # demo subjects, doubts, answers, resolved threads
```

The pgvector migration fails cleanly if the server cannot install the extension;
everything except semantic ranking keeps working (search then reports
`degraded: true`).

## AI Configuration
Set these in `backend/.env` (see `backend/.env.example` for the full list):

```bash
# Semantic search (embeddings)
EMBEDDING_PROVIDER=openai            # openai | gemini | huggingface
EMBEDDING_API_KEY=...                # leave empty -> keyword-only search (labelled as degraded)
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536            # must match the pgvector column

# AI Doubt Assistant (chat model)
LLM_PROVIDER=openai                  # openai | gemini | groq
LLM_API_KEY=...                      # leave empty -> /ai/ask returns 503 AI_NOT_CONFIGURED
LLM_MODEL=gpt-4o-mini
```

Keys are read only by the backend; the frontend bundle never contains them.
After changing the embedding model/dimension, re-run the backfill:
`npm run embeddings:backfill -- 200`.

## Development
Frontend (http://localhost:5173):
```bash
cd frontend
npm run dev
```

Backend (http://localhost:4000):
```bash
cd backend
npm run dev
```

## Health Check
Once backend is running: `GET http://localhost:4000/api/v1/health`

## AI & Search API
| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/v1/search/semantic?q=…` | optional | semantic + keyword hybrid search (`subjectId`, `isResolved`, `page`, `limit`, `minScore`) |
| `GET /api/v1/search/similar?q=…` | optional | similar existing doubts while posting (`limit`, `excludeDoubtId`) |
| `GET /api/v1/ai/config` | none | capability report + explanation modes (no secrets) |
| `POST /api/v1/ai/ask` | required | RAG answer (`question`, `mode`, optional `subjectId`) |
| `POST /api/v1/ai/doubts/:id/ask` | required | RAG answer about an existing doubt |
| `POST /api/v1/ai/index/backfill` | required | index up to 50 pending doubts |

Rate limits: 10 AI requests/min/user and 60 search requests/min/user-IP
(`AI_RATE_LIMIT_PER_MINUTE`, `SEARCH_RATE_LIMIT_PER_MINUTE`).

## Validation
Frontend:
```bash
cd frontend
npm run typecheck
npm run build
npm run test
```

Backend:
```bash
cd backend
npm run typecheck
npm run build
npm run test
npx prisma validate
npx prisma generate
npm run embeddings:backfill -- 200   # optional: needs keys + migrated DB
```

Tests are hermetic: `backend/tests/setup.ts` replaces the Prisma client with an
in-memory double, so the suite runs without PostgreSQL, pgvector or provider keys.

## Troubleshooting
- If Prisma client not generated, run `npx prisma generate` in backend.
- If DB connection fails, migrations will not run; typecheck/build can still pass without DB.
- Ensure `backend/.env` has correct `DATABASE_URL` when running migrations/runtime.
- Frontend proxies `/api` to `http://localhost:4000` in dev.
- Semantic search returns `degradedReason: "embedding-provider-not-configured"` when
  no embedding key is set, and `"vector-store-unavailable"` when the pgvector
  extension/table is missing.
- `/ai/ask` returning `503 AI_NOT_CONFIGURED` means `LLM_API_KEY` is unset — no
  mock answer is produced by design.
- Changing `EMBEDDING_DIMENSIONS` without a migration makes inserts fail with a
  vector-dimension error; the column is `vector(1536)`.
