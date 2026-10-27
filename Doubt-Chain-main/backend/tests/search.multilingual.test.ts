import { describe, it, expect } from 'vitest'
import { expandQuery } from '../src/services/search/text.js'
import { keywordScore } from '../src/services/search/similarity.js'

/**
 * Cross-language retrieval evaluation.
 *
 * The keyword channel is evaluated end-to-end against a small, fixed corpus
 * containing the same concept written in English, Hindi (Devanagari) and
 * Hinglish. This measures the glossary-based bridging that runs without an
 * embedding provider.
 *
 * The vector channel cannot be evaluated offline: its cross-language quality
 * depends on the configured embedding model (see Docs/11-ai-implementation.md).
 */

type Doc = { id: string; title: string; content: string }

const CORPUS: Doc[] = [
  {
    id: 'en-queue',
    title: 'Why does a circular queue report overflow when it is not full?',
    content:
      'The front and rear pointers use the same slot after a few deletions, so the queue looks full even though only two elements are stored.'
  },
  {
    id: 'hi-queue',
    title: 'सर्कुलर क्यू पूरा क्यों दिखा रहा है जबकि वह खाली है?',
    content:
      'फ्रंट और रियर पॉइंटर एक ही जगह आ जाते हैं इसलिए क्यू भरा हुआ दिखता है। समस्या का कारण यही है।'
  },
  {
    id: 'hi-queue-hinglish',
    title: 'Mera circular queue full kyu dikha raha hai jabki wo khali hai?',
    content: 'Front aur rear pointer same slot pe aa jate hain, isliye queue full dikhta hai.'
  },
  {
    id: 'en-recursion',
    title: 'How does recursion work in Python?',
    content: 'A recursive function calls itself with a smaller input until it reaches the base case.'
  },
  {
    id: 'hi-recursion',
    title: 'पायथन में पुनरावृत्ति कैसे काम करती है?',
    content: 'पुनरावृत्ति में फलन स्वयं को छोटे इनपुट के साथ बुलाता है जब तक आधार शर्त पूरी न हो।'
  },
  {
    id: 'en-deadlock',
    title: 'What is a deadlock in an operating system?',
    content: 'Two processes wait for locks held by each other, so neither can proceed.'
  }
]

/** Mirror of the production keyword channel: expand the query, score, threshold. */
function keywordRetrieve(query: string, minScore = 0.05): Array<{ id: string; score: number; matched: string[] }> {
  const expanded = expandQuery(query)
  return CORPUS.map((doc) => {
    const { score, matched } = keywordScore(doc, expanded.conceptGroups)
    return { id: doc.id, score, matched }
  })
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
}

describe('Cross-language keyword retrieval', () => {
  it('finds English doubts from an English query', () => {
    const results = keywordRetrieve('circular queue overflow when not full')
    expect(results[0].id).toBe('en-queue')
    expect(results.map((entry) => entry.id)).not.toContain('en-deadlock')
  })

  it('finds Hindi doubts from a Hindi query', () => {
    const results = keywordRetrieve('सर्कुलर क्यू पूरा क्यों दिखा रहा है')
    expect(results[0].id).toBe('hi-queue')
  })

  it('finds Hinglish doubts from a Hinglish query', () => {
    const results = keywordRetrieve('mera circular queue full kyu dikha raha hai')
    expect(results[0].id).toBe('hi-queue-hinglish')
  })

  it('bridges English queries to Hindi content through native term expansion', () => {
    const results = keywordRetrieve('recursion base case')
    const ids = results.map((entry) => entry.id)
    expect(ids).toContain('en-recursion')
    expect(ids).toContain('hi-recursion')
  })

  it('bridges Hindi queries to English content through English glosses', () => {
    const results = keywordRetrieve('पुनरावृत्ति कैसे काम करती है')
    const ids = results.map((entry) => entry.id)
    expect(ids).toContain('hi-recursion')
    expect(ids).toContain('en-recursion')
  })

  it('bridges Hinglish queries to English content', () => {
    const results = keywordRetrieve('queue full kyu dikha raha hai')
    const ids = results.map((entry) => entry.id)
    expect(ids[0]).toBe('hi-queue-hinglish')
    expect(ids).toContain('en-queue')
  })

  it('does not collapse unrelated topics when bridging', () => {
    const results = keywordRetrieve('deadlock operating system')
    expect(results[0].id).toBe('en-deadlock')
    expect(results).toHaveLength(1)
  })

  it('reports why a match was made (explainable retrieval)', () => {
    const results = keywordRetrieve('पुनरावृत्ति')
    const hindiMatch = results.find((entry) => entry.id === 'hi-recursion')
    expect(hindiMatch?.matched).toContain('पुनरावृत्ति')
  })

  it('produces an embedding query with English glosses for multilingual models', () => {
    const hinglish = expandQuery('queue full kyu ho raha hai')
    expect(hinglish.embeddingText).toContain('English keywords:')
    expect(hinglish.embeddingText).toContain('why')

    const hindi = expandQuery('क्यू पूरा क्यों हो रहा है')
    expect(hindi.embeddingText).toContain('English keywords:')

    // English queries are embedded verbatim (no noise added).
    const english = expandQuery('queue full why')
    expect(english.embeddingText).toBe('queue full why')
  })
})
