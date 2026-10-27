/**
 * Minimal, dependency-free renderer for AI answers.
 *
 * The assistant returns light Markdown (headings, lists, fenced code, **bold**,
 * `inline code` and [S1] citation markers). Everything is parsed into plain
 * data structures and rendered as React elements — never via innerHTML — so AI
 * output cannot inject markup into the page.
 */

export type AnswerBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string | null; code: string }

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'code'; value: string }
  | { type: 'citation'; index: number; raw: string }

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/
const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/
const CITATION = /\[\s*S\s*(\d{1,2})\s*\]/gi

/** Split an AI answer into block-level structures. */
export function parseAnswerBlocks(input: string): AnswerBlock[] {
  const lines = (input ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks: AnswerBlock[] = []

  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let code: { language: string | null; lines: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list && list.items.length > 0) blocks.push({ type: 'list', ...list })
    list = null
  }

  for (const line of lines) {
    const fence = line.match(FENCE)
    if (fence && !code) {
      flushParagraph()
      flushList()
      code = { language: fence[1] ? fence[1] : null, lines: [] }
      continue
    }
    if (fence && code) {
      blocks.push({ type: 'code', language: code.language, code: code.lines.join('\n') })
      code = null
      continue
    }
    if (code) {
      code.lines.push(line)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        level: Math.min(heading[1].length, 3) as 1 | 2 | 3,
        text: heading[2].trim()
      })
      continue
    }

    const bullet = line.match(BULLET)
    if (bullet) {
      flushParagraph()
      if (!list || list.ordered) flushList()
      list = list ?? { ordered: false, items: [] }
      list.items.push(bullet[1].trim())
      continue
    }

    const numbered = line.match(NUMBERED)
    if (numbered) {
      flushParagraph()
      if (!list || !list.ordered) flushList()
      list = list ?? { ordered: true, items: [] }
      list.items.push(numbered[2].trim())
      continue
    }

    // Continuation of the current list item (wrapped line).
    if (list) {
      list.items[list.items.length - 1] = `${list.items[list.items.length - 1]} ${line.trim()}`.trim()
      continue
    }

    paragraph.push(line.trim())
  }

  // Unterminated code fence: keep whatever was captured rather than dropping it.
  if (code) blocks.push({ type: 'code', language: code.language, code: code.lines.join('\n') })
  flushParagraph()
  flushList()

  return blocks
}

/** Split inline text into bold / inline-code / citation tokens. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[\s*S\s*\d{1,2}\s*\])/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    const raw = match[0]
    if (raw.startsWith('**')) {
      tokens.push({ type: 'bold', value: raw.slice(2, -2) })
    } else if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) })
    } else {
      const digits = raw.replace(/[^\d]/g, '')
      tokens.push({ type: 'citation', index: Number(digits), raw })
    }
    lastIndex = match.index + raw.length
  }

  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) })
  return tokens
}

/** Citation numbers used by an answer, in ascending order (deduplicated). */
export function citedSourceIndexes(answer: string): number[] {
  const found = new Set<number>()
  let match: RegExpExecArray | null
  const pattern = new RegExp(CITATION.source, 'gi')
  while ((match = pattern.exec(answer)) !== null) found.add(Number(match[1]))
  return [...found].sort((a, b) => a - b)
}
