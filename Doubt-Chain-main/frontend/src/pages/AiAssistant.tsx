import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppShell from '../layouts/AppShell'
import ProtectedRoute from '../components/ProtectedRoute'
import ErrorState from '../components/ErrorState'
import AiAnswerCard from '../components/AiAnswerCard'
import ExplanationModeSelector from '../components/ExplanationModeSelector'
import { aiService } from '../services/aiService'
import { AiAnswer, AiConfig, ExplanationMode, ExplanationModeInfo } from '../types/api'
import { DEFAULT_MODE, FALLBACK_MODES } from '../lib/aiModes'

const EXAMPLE_QUESTIONS = [
  'Why does my circular queue report full when it is not?',
  'Mera pointer null kyu ho raha hai while deleting a node?',
  'सर्कुलर क्यू में front और rear pointer कैसे काम करते हैं?',
  'Why does recursion cause a stack overflow for large inputs?'
]

const MAX_QUESTION_LENGTH = 4000

function AiAssistantInner() {
  const [searchParams] = useSearchParams()
  const doubtId = searchParams.get('doubtId') ?? undefined
  const prefill = searchParams.get('q') ?? ''

  const [config, setConfig] = useState<AiConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [question, setQuestion] = useState(prefill.slice(0, MAX_QUESTION_LENGTH))
  const [mode, setMode] = useState<ExplanationMode>(DEFAULT_MODE)
  const [answer, setAnswer] = useState<AiAnswer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    aiService
      .getConfig()
      .then((data) => {
        if (!active) return
        setConfig(data)
        if (data.defaultMode) setMode(data.defaultMode)
      })
      .catch((err: Error) => {
        if (active) setConfigError(err.message)
      })
    return () => {
      active = false
    }
  }, [])

  const modes: ExplanationModeInfo[] = config?.modes?.length ? config.modes : FALLBACK_MODES
  const assistantConfigured = config ? config.assistantConfigured : true
  const tooShort = question.trim().length < 8
  const canSubmit = useMemo(() => !loading && !tooShort, [loading, tooShort])

  const ask = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    setErrorCode(null)
    try {
      const result = doubtId
        ? await aiService.askAboutDoubt(doubtId, { mode, question: question.trim() || undefined })
        : await aiService.ask({ question: question.trim(), mode })
      setAnswer(result)
    } catch (err) {
      const typed = err as Error & { status?: number; details?: { code?: string } }
      setError(typed.message)
      setErrorCode(typed.details?.code ?? (typed.status === 429 ? 'AI_RATE_LIMITED' : null))
      setAnswer(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-5 animate-fade-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-dc-text">AI Doubt Assistant</h1>
            <p className="mt-0.5 text-sm text-dc-subtext">
              Answers are grounded in Doubt-Chain discussions wherever possible. Sources are linked;
              unverified content is labelled.
            </p>
          </div>
          {doubtId && (
            <Link to={`/doubts/${doubtId}`} className="text-xs text-dc-blue hover:underline underline-offset-2">
              Back to discussion
            </Link>
          )}
        </div>

        {config?.assistantConfigured === false && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
            <p className="font-medium">The assistant is not configured on this server.</p>
            <p className="mt-1 text-amber-200/80">
              Add <code className="font-mono">LLM_PROVIDER</code>, <code className="font-mono">LLM_API_KEY</code> and{' '}
              <code className="font-mono">LLM_MODEL</code> to the backend environment (see{' '}
              <code className="font-mono">backend/.env.example</code>) to enable AI answers. Semantic search
              keeps working independently with <code className="font-mono">EMBEDDING_API_KEY</code>.
            </p>
          </div>
        )}

        {config && !config.embeddingsConfigured && (
          <p className="text-xs text-dc-subtext">
            Semantic retrieval is not configured, so community context is matched by keywords only.
          </p>
        )}

        {configError && (
          <p className="text-xs text-dc-subtext">Could not load AI configuration: {configError}</p>
        )}

        <section className="dc-card space-y-4 p-5">
          <div>
            <label htmlFor="ai-question" className="dc-label">
              {doubtId ? 'Add context for this doubt (optional)' : 'Your question'}
            </label>
            <textarea
              id="ai-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, MAX_QUESTION_LENGTH))}
              rows={5}
              placeholder="Ask anything you are stuck on — English, Hindi or Hinglish."
              className="dc-input resize-none"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-dc-subtext">
              <span>{tooShort ? 'Add a little more detail (8+ characters).' : 'Tip: include the error or code.'}</span>
              <span>
                {question.length}/{MAX_QUESTION_LENGTH}
              </span>
            </div>
          </div>

          <div>
            <p className="dc-label-sub">Explanation mode</p>
            <ExplanationModeSelector
              modes={modes}
              value={mode}
              onChange={setMode}
              disabled={loading}
            />
            <p className="mt-1.5 text-[11px] text-dc-subtext">
              {modes.find((item) => item.id === mode)?.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_QUESTIONS.slice(0, 2).map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="rounded-full border border-dc-border px-2.5 py-1 text-[11px] text-dc-subtext transition-colors hover:border-dc-blue/40 hover:text-dc-text"
                >
                  {example.length > 44 ? `${example.slice(0, 44)}…` : example}
                </button>
              ))}
            </div>
            <button type="button" onClick={ask} disabled={!canSubmit} className="dc-btn-primary">
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Thinking…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                  Ask AI
                </>
              )}
            </button>
          </div>

          {!assistantConfigured && (
            <p className="text-[11px] text-amber-200/80">
              Requests will fail with a clear configuration error until a provider key is added.
            </p>
          )}
        </section>

        {error && (
          <div className="space-y-2">
            <ErrorState
              message={error}
              onRetry={errorCode === 'AI_RATE_LIMITED' ? undefined : ask}
            />
            {errorCode === 'AI_RATE_LIMITED' && (
              <p className="text-xs text-dc-subtext">
                The assistant allows a limited number of requests per minute. Wait a moment, then try
                again — or use semantic search in the meantime.
              </p>
            )}
          </div>
        )}

        {loading && !answer && (
          <div className="dc-card space-y-3 p-5" role="status" aria-live="polite">
            <div className="dc-skeleton h-4 w-32 rounded-full" />
            <div className="dc-skeleton h-3 w-full" />
            <div className="dc-skeleton h-3 w-5/6" />
            <div className="dc-skeleton h-3 w-2/3" />
            <p className="text-[11px] text-dc-subtext">
              Retrieving Doubt-Chain discussions and asking the model…
            </p>
          </div>
        )}

        {answer && <AiAnswerCard answer={answer} onRegenerate={ask} regenerating={loading} />}
      </div>
    </AppShell>
  )
}

export default function AiAssistant() {
  return (
    <ProtectedRoute>
      <AiAssistantInner />
    </ProtectedRoute>
  )
}
