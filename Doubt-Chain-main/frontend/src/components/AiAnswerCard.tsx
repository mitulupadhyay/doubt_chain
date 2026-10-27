import { Link } from 'react-router-dom'
import { AiAnswer, AiSource } from '../types/api'
import { AnswerBlock, InlineToken, parseAnswerBlocks, parseInline } from '../lib/answerFormat'
import { orderSourcesForDisplay } from '../lib/aiModes'

function Inline({
  text,
  sources
}: {
  text: string
  sources: AiSource[]
}) {
  return (
    <>
      {parseInline(text).map((token: InlineToken, index: number) => {
        if (token.type === 'bold') {
          return (
            <strong key={index} className="font-semibold text-dc-text">
              {token.value}
            </strong>
          )
        }
        if (token.type === 'code') {
          return (
            <code
              key={index}
              className="rounded border border-dc-border bg-dc-bg px-1 py-0.5 font-mono text-[0.85em] text-sky-300"
            >
              {token.value}
            </code>
          )
        }
        if (token.type === 'citation') {
          const source = sources.find((candidate) => candidate.index === token.index)
          if (!source) {
            return (
              <span key={index} className="text-dc-subtext">
                {token.raw}
              </span>
            )
          }
          return (
            <Link
              key={index}
              to={source.url}
              title={`Source ${token.index}: ${source.title}`}
              className="mx-0.5 inline-flex items-center rounded border border-dc-blue/40 bg-dc-blue/10 px-1 text-[0.7em] font-medium text-sky-300 align-top hover:bg-dc-blue/20"
            >
              S{token.index}
            </Link>
          )
        }
        return <span key={index}>{token.value}</span>
      })}
    </>
  )
}

function Block({ block, sources }: { block: AnswerBlock; sources: AiSource[] }) {
  if (block.type === 'code') {
    return (
      <pre className="overflow-x-auto rounded-lg border border-dc-border bg-dc-bg p-3 text-xs leading-relaxed">
        <code className="font-mono text-emerald-200">{block.code}</code>
      </pre>
    )
  }
  if (block.type === 'heading') {
    const cls =
      block.level === 1
        ? 'text-base font-semibold'
        : block.level === 2
          ? 'text-sm font-semibold'
          : 'text-sm font-medium'
    return (
      <h4 className={`${cls} text-dc-text`}>
        <Inline text={block.text} sources={sources} />
      </h4>
    )
  }
  if (block.type === 'list') {
    const ListTag = block.ordered ? 'ol' : 'ul'
    return (
      <ListTag
        className={`space-y-1 pl-5 text-sm leading-relaxed text-dc-text ${
          block.ordered ? 'list-decimal' : 'list-disc'
        }`}
      >
        {block.items.map((item, index) => (
          <li key={index}>
            <Inline text={item} sources={sources} />
          </li>
        ))}
      </ListTag>
    )
  }
  return (
    <p className="text-sm leading-relaxed text-dc-text">
      <Inline text={block.text} sources={sources} />
    </p>
  )
}

type Props = {
  answer: AiAnswer
  onRegenerate?: () => void
  regenerating?: boolean
}

export default function AiAnswerCard({ answer, onRegenerate, regenerating }: Props) {
  const blocks = parseAnswerBlocks(answer.answer)
  const cited = answer.sources.filter((source) => source.cited)
  const orderedSources = orderSourcesForDisplay(answer.sources)

  return (
    <article className="dc-card animate-slide-up space-y-4 p-5" aria-label="AI generated answer">
      {/* Header: explicit AI provenance */}
      <header className="flex flex-wrap items-center gap-2 border-b border-dc-border pb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-300">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
            />
          </svg>
          AI-generated
        </span>
        <span className="rounded-full border border-dc-border px-2.5 py-0.5 text-xs text-dc-subtext">
          {answer.modeLabel}
        </span>
        {answer.grounded ? (
          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">
            {cited.length} community source{cited.length === 1 ? '' : 's'} cited
          </span>
        ) : (
          <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300">
            No community source cited
          </span>
        )}
        <span className="ml-auto text-[11px] text-dc-subtext">
          {answer.model} · {answer.latencyMs} ms
        </span>
      </header>

      {answer.insufficientContext && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m0 3h.008v.008H12v-.008zM10.34 3.94l-8.4 14.54A1.5 1.5 0 003.24 21h17.52a1.5 1.5 0 001.3-2.52l-8.4-14.54a1.5 1.5 0 00-2.6 0z"
            />
          </svg>
          <span>
            The Doubt-Chain community context for this question was thin or missing, so parts of this
            explanation come from the model's general knowledge rather than a verified discussion.
          </span>
        </div>
      )}

      {answer.retrieval.degraded && (
        <p className="text-[11px] text-dc-subtext">
          Retrieval note: semantic search was degraded{answer.retrieval.degradedReason ? ` (${answer.retrieval.degradedReason})` : ''}, so
          matching fell back to keyword search.
        </p>
      )}

      {/* Answer body */}
      <div className="space-y-3">
        {blocks.map((block, index) => (
          <Block key={index} block={block} sources={answer.sources} />
        ))}
      </div>

      {/* Sources */}
      {answer.sources.length > 0 && (
        <section className="space-y-2 border-t border-dc-border pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-dc-subtext">
            Discussions used
          </h4>
          <ul className="space-y-2">
            {orderedSources.map((source) => (
              <li key={source.doubtId}>
                <Link
                  to={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2 rounded-lg border border-dc-border p-2.5 transition-colors hover:border-dc-blue/40 hover:bg-white/5"
                >
                  <span className="mt-0.5 rounded border border-dc-border px-1 text-[10px] font-mono text-dc-subtext">
                    {source.cited ? `S${source.index}` : '•'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-dc-text group-hover:text-white">
                      {source.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-dc-subtext">
                      {source.isResolved ? 'Resolved' : 'Open'} · {source.answerCount} answer
                      {source.answerCount === 1 ? '' : 's'} · {Math.round(source.score * 100)}% match
                    </span>
                  </span>
                  <span className="text-[10px] text-dc-subtext">↗</span>
                </Link>
              </li>
            ))}
          </ul>
          {cited.length === 0 && (
            <p className="text-[11px] text-dc-subtext">
              These discussions were retrieved as context, but the assistant did not cite them
              directly.
            </p>
          )}
        </section>
      )}

      {/* Disclaimer */}
      <footer className="space-y-3 border-t border-dc-border pt-3">
        <p className="text-[11px] leading-relaxed text-dc-subtext">{answer.disclaimer}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-dc-subtext">
            {new Date(answer.generatedAt).toLocaleString('en-IN')} · {answer.provider}
          </span>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="dc-btn-secondary px-3 py-1.5 text-xs"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          )}
        </div>
      </footer>
    </article>
  )
}
