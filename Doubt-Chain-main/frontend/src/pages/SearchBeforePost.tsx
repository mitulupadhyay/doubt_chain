import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../layouts/AppShell'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import StatusBadge from '../components/StatusBadge'
import { doubtService } from '../services/doubtService'
import { SemanticSearchResponse, Subject } from '../types/api'
import { degradationMessage } from '../lib/aiModes'

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी',
  hinglish: 'Hinglish'
}

const MODE_LABEL: Record<SemanticSearchResponse['mode'], string> = {
  semantic: 'Semantic (vector)',
  hybrid: 'Semantic + keyword',
  keyword: 'Keyword fallback'
}

export default function SearchBeforePost() {
  const [query, setQuery] = useState('')
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectId, setSubjectId] = useState('')
  const [status, setStatus] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<SemanticSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    doubtService.listSubjects().then(setSubjects).catch(() => setSubjects([]))
  }, [])

  useEffect(() => {
    setPage(1)
  }, [query, subjectId, status])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 3) {
      setResult(null)
      setError(null)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      doubtService
        .semanticSearch(trimmed, {
          subjectId: subjectId || undefined,
          isResolved: status === '' ? undefined : status === 'true',
          page,
          limit: 10
        })
        .then((data) => {
          if (active) setResult(data)
        })
        .catch((err: Error) => {
          if (active) {
            setError(err.message)
            setResult(null)
          }
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 350)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, subjectId, status, page])

  const hasQuery = query.trim().length >= 3
  const items = result?.items ?? []

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
        <div>
          <h1 className="text-xl font-bold text-dc-text">Search Before Posting</h1>
          <p className="mt-0.5 text-sm text-dc-subtext">
            Semantic search over existing doubts — ask in English, Hindi or Hinglish.
          </p>
        </div>

        {/* Search controls */}
        <div className="dc-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dc-subtext" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
              </svg>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type your question (e.g. circular queue full kyu dikha raha hai)"
                aria-label="Search existing doubts"
                className="dc-input pl-9"
                autoFocus
              />
              {loading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="h-4 w-4 animate-spin text-dc-blue" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </div>
              )}
            </div>
            <select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              aria-label="Filter by subject"
              className="dc-input w-auto flex-none"
            >
              <option value="">All subjects</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as '' | 'true' | 'false')}
              aria-label="Filter by status"
              className="dc-input w-auto flex-none"
            >
              <option value="">Any status</option>
              <option value="true">Resolved</option>
              <option value="false">Open</option>
            </select>
          </div>

          {/* Retrieval transparency */}
          {result && hasQuery && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-dc-subtext">
              <span className="rounded-full border border-dc-border px-2 py-0.5">{MODE_LABEL[result.mode]}</span>
              <span className="rounded-full border border-dc-border px-2 py-0.5">
                Detected: {LANGUAGE_LABEL[result.language] ?? result.language}
              </span>
              <span>
                {result.total} match{result.total === 1 ? '' : 'es'}
                {result.scores.topScore !== null && ` · best ${Math.round(result.scores.topScore * 100)}%`}
              </span>
              {result.glosses.length > 0 && (
                <span className="truncate">Bridged terms: {result.glosses.slice(0, 4).join(', ')}</span>
              )}
            </div>
          )}

          {result?.degraded && (
            <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
              {degradationMessage(result.degradedReason)}
            </p>
          )}
        </div>

        {/* Results */}
        <div className="dc-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-dc-text">
              {hasQuery ? `${items.length} result${items.length === 1 ? '' : 's'} on this page` : 'Results'}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {hasQuery && (
                <Link
                  to={`/assistant?q=${encodeURIComponent(query.trim())}`}
                  className="dc-btn-secondary text-xs"
                >
                  Ask AI instead
                </Link>
              )}
              <Link to="/doubts/new" className="dc-btn-primary text-sm">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Post New Doubt
              </Link>
            </div>
          </div>

          {error && <ErrorState message={error} />}

          {!hasQuery && !error && (
            <EmptyState
              title="Start typing above"
              description="Matches are ranked by meaning, not just keywords. Hindi and Hinglish queries are supported."
            />
          )}

          {hasQuery && loading && items.length === 0 && (
            <div className="space-y-2" role="status" aria-live="polite">
              {[0, 1, 2].map((index) => (
                <div key={index} className="rounded-lg border border-dc-border p-3.5">
                  <div className="dc-skeleton h-3.5 w-2/3" />
                  <div className="dc-skeleton mt-2 h-2.5 w-1/3" />
                </div>
              ))}
            </div>
          )}

          {hasQuery && !loading && !error && items.length === 0 && (
            <EmptyState
              title="No matches found"
              description="No existing doubt is close enough to your question. You can post it as a new doubt."
              action={
                <Link to="/doubts/new" className="dc-btn-primary text-sm">
                  Post a new doubt
                </Link>
              }
            />
          )}

          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((doubt) => (
                <Link
                  key={doubt.id}
                  to={`/doubts/${doubt.id}`}
                  className="group block rounded-lg border border-dc-border p-3.5 transition-colors hover:border-dc-blue/40 hover:bg-white/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-dc-text group-hover:text-white">
                        {doubt.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-dc-subtext">
                        {doubt.subject?.name}
                        {' · '}
                        {doubt._count?.answers ?? 0} answer{(doubt._count?.answers ?? 0) === 1 ? '' : 's'}
                        {doubt.author?.displayName ? ` · ${doubt.author.displayName}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={doubt.isResolved ? 'resolved' : 'unresolved'} />
                      <span className="text-[10px] uppercase tracking-wide text-dc-subtext">
                        {Math.round(doubt.score * 100)}% · {doubt.matchType}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {result && result.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-dc-border pt-3">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
                className="dc-btn-secondary px-3 py-1.5 text-xs"
              >
                Previous
              </button>
              <span className="text-xs text-dc-subtext">
                Page {result.page} of {result.totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={page >= result.totalPages || loading}
                className="dc-btn-secondary px-3 py-1.5 text-xs"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
