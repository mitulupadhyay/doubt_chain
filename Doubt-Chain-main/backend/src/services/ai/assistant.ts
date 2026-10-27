import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../middleware/errorHandler.js'
import { getLlmProvider, LlmProvider, completeChat } from '../../ai/llm.js'
import { EmbeddingProvider } from '../../ai/embedding.js'
import { AiProviderError } from '../../ai/errors.js'
import { retrieveContextForQuestion } from '../search/semanticSearch.js'
import { detectLanguage, QueryLanguage } from '../search/text.js'
import {
  buildDisclaimer,
  buildMessages,
  ContextSourceInput,
  extractCitations,
  stripInvalidCitations
} from './prompts.js'
import { ExplanationMode, MODE_DEFINITIONS, resolveMode } from './modes.js'

export type AiSource = {
  /** 1-based marker index used in the answer (`[S1]` → 1). */
  index: number
  doubtId: string
  title: string
  url: string
  snippet: string
  score: number
  isResolved: boolean
  answerCount: number
  cited: boolean
}

export type AssistantAnswer = {
  answer: string
  mode: ExplanationMode
  modeLabel: string
  aiGenerated: true
  grounded: boolean
  insufficientContext: boolean
  sources: AiSource[]
  disclaimer: string
  language: QueryLanguage
  retrieval: {
    used: boolean
    degraded: boolean
    degradedReason?: string
    topScore: number | null
    retrieved: number
  }
  provider: string
  model: string
  latencyMs: number
  generatedAt: string
}

export type AskInput = {
  question: string
  mode?: ExplanationMode | string
  subjectId?: string
  doubtId?: string
  userId?: string
  topK?: number
}

/** Below this cosine similarity the retrieved community context is treated as weak. */
export const INSUFFICIENT_CONTEXT_SCORE = 0.35

function toContextSources(
  doubts: Awaited<ReturnType<typeof retrieveContextForQuestion>>['doubts'],
  answersByDoubt: Awaited<ReturnType<typeof retrieveContextForQuestion>>['answersByDoubt']
): ContextSourceInput[] {
  return doubts.map((doubt) => ({
    doubtId: doubt.id,
    title: doubt.title,
    content: doubt.content,
    subject: doubt.subject?.name,
    isResolved: doubt.isResolved,
    score: doubt.score,
    answers: answersByDoubt.get(doubt.id) ?? []
  }))
}

function toAiSources(
  contextSources: ContextSourceInput[],
  citedIndexes: number[],
  answerCounts: Map<string, number>
): AiSource[] {
  const citedSet = new Set(citedIndexes)
  return contextSources.map((source, position) => ({
    index: position + 1,
    doubtId: source.doubtId,
    title: source.title,
    url: `/doubts/${source.doubtId}`,
    snippet: source.answers[0]?.content?.slice(0, 240) ?? source.content.slice(0, 240),
    score: source.score,
    isResolved: source.isResolved,
    answerCount: answerCounts.get(source.doubtId) ?? source.answers.length,
    cited: citedSet.has(position + 1)
  }))
}

async function persistInteraction(input: {
  userId?: string
  doubtId?: string
  mode: ExplanationMode
  question: string
  answer: string
  grounded: boolean
  provider: string
  model: string
  latencyMs: number
  sources: AiSource[]
}): Promise<void> {
  try {
    await prisma.aiInteraction.create({
      data: {
        userId: input.userId,
        doubtId: input.doubtId,
        mode: input.mode,
        question: input.question.slice(0, 4000),
        answer: input.answer.slice(0, 20000),
        grounded: input.grounded,
        provider: input.provider,
        model: input.model,
        latencyMs: input.latencyMs,
        sources: input.sources.map((source) => ({
          doubtId: source.doubtId,
          title: source.title,
          score: source.score,
          cited: source.cited
        }))
      }
    })
  } catch (error) {
    // Auditing must never break the answer that was already generated.
    console.warn(
      `[ai] failed to persist interaction: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown error'}`
    )
  }
}

/**
 * Retrieval-Augmented Generation for a student question.
 *
 * - retrieval runs first; generated text is grounded in the retrieved rows and
 *   citations are mapped back to real Doubt records (invalid markers removed)
 * - if the LLM is not configured or errors out, an AiProviderError is thrown so
 *   the caller returns an explicit 503 instead of a fabricated answer
 */
export async function askDoubtAssistant(
  input: AskInput,
  deps: { llm?: LlmProvider | null; embeddingProvider?: EmbeddingProvider | null } = {}
): Promise<AssistantAnswer> {
  const mode = resolveMode(input.mode)
  let question = input.question?.trim() ?? ''
  let subjectId = input.subjectId
  let excludeDoubtId = input.doubtId

  if (input.doubtId) {
    const doubt = await prisma.doubt.findUnique({
      where: { id: input.doubtId },
      include: { subject: { select: { id: true, name: true, code: true } } }
    })
    if (!doubt) throw new HttpError(404, 'Doubt not found')
    if (!question) question = `${doubt.title}\n\n${doubt.content}`
    subjectId = subjectId ?? doubt.subjectId
    excludeDoubtId = doubt.id
  }

  if (question.length < 8) {
    throw new HttpError(400, 'Question is too short. Add at least a sentence of detail.')
  }

  const llm = deps.llm === undefined ? getLlmProvider() : deps.llm
  if (!llm) {
    throw new AiProviderError('not_configured', 'AI assistant is not configured on this server', {
      provider: 'none'
    })
  }

  const retrieval = await retrieveContextForQuestion(
    {
      question,
      subjectId,
      excludeDoubtId,
      topK: input.topK
    },
    { provider: deps.embeddingProvider }
  )

  const contextSources = toContextSources(retrieval.doubts, retrieval.answersByDoubt)
  const messages = buildMessages({ question, mode, sources: contextSources })

  const completion = await completeChat(messages, llm)
  const { cited, invalid } = extractCitations(completion.text, contextSources.length)
  const cleanedAnswer = stripInvalidCitations(completion.text, contextSources.length).trim()

  const answerCounts = new Map(
    retrieval.doubts.map((doubt) => [doubt.id, doubt._count?.answers ?? 0] as const)
  )
  const sources = toAiSources(contextSources, cited, answerCounts)

  const topScore = retrieval.topScore
  const insufficientContext =
    contextSources.length === 0 || topScore === null || topScore < INSUFFICIENT_CONTEXT_SCORE
  const grounded = cited.length > 0

  if (invalid.length > 0) {
    console.warn(`[ai] dropped ${invalid.length} citation marker(s) that had no matching source`)
  }

  const answer: AssistantAnswer = {
    answer: cleanedAnswer,
    mode,
    modeLabel: MODE_DEFINITIONS[mode].label,
    aiGenerated: true,
    grounded,
    insufficientContext,
    sources,
    disclaimer: buildDisclaimer({
      grounded: contextSources.length > 0,
      citedCount: cited.length,
      degraded: retrieval.degraded
    }),
    language: detectLanguage(question),
    retrieval: {
      used: contextSources.length > 0,
      degraded: retrieval.degraded,
      degradedReason: retrieval.degradedReason,
      topScore,
      retrieved: contextSources.length
    },
    provider: completion.provider,
    model: completion.model,
    latencyMs: completion.latencyMs,
    generatedAt: new Date().toISOString()
  }

  await persistInteraction({
    userId: input.userId,
    doubtId: input.doubtId,
    mode,
    question,
    answer: answer.answer,
    grounded: answer.grounded,
    provider: answer.provider,
    model: answer.model,
    latencyMs: answer.latencyMs,
    sources
  })

  return answer
}
