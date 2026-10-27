-- Phase 4: enable pgvector for semantic search / RAG retrieval.
--
-- Additive and idempotent: only creates the extension. No existing table,
-- column, index or row is touched.
--
-- Requirement: the PostgreSQL server must ship the `vector` extension
-- (managed Postgres such as Supabase/Neon/RDS do; local installs need
-- `postgresql-<version>-pgvector`). If it is unavailable this migration fails
-- cleanly and nothing else is modified.
CREATE EXTENSION IF NOT EXISTS vector;
