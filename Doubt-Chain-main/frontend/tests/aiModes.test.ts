import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MODE,
  FALLBACK_MODES,
  degradationMessage,
  modeLabel,
  orderSourcesForDisplay
} from '../src/lib/aiModes'

describe('Explanation mode catalogue (frontend)', () => {
  it('mirrors the five backend modes', () => {
    expect(FALLBACK_MODES.map((mode) => mode.id)).toEqual([
      'beginner',
      'step_by_step',
      'simple_example',
      'hinglish',
      'debug_code'
    ])
    expect(DEFAULT_MODE).toBe('beginner')
  })

  it('resolves labels and degrades gracefully', () => {
    expect(modeLabel('hinglish')).toBe('Explain in Hinglish')
    expect(modeLabel('debug_code')).toBe('Help Me Debug This Code')
  })
})

describe('Degradation messaging', () => {
  it('explains every known degraded reason in plain language', () => {
    expect(degradationMessage('embedding-provider-not-configured')).toMatch(/not configured/i)
    expect(degradationMessage('vector-store-unavailable')).toMatch(/vector index/i)
    expect(degradationMessage('AI provider timed out')).toMatch(/timed out/i)
  })

  it('falls back to a generic explanation', () => {
    expect(degradationMessage('something-new')).toMatch(/degraded/i)
    expect(degradationMessage(undefined)).toMatch(/keyword/i)
  })
})

describe('Source ordering', () => {
  it('shows cited sources first while preserving S-numbers', () => {
    const base = {
      doubtId: 'd',
      title: 't',
      url: '/doubts/d',
      snippet: '',
      score: 0.5,
      isResolved: true,
      answerCount: 1
    }
    const ordered = orderSourcesForDisplay([
      { ...base, index: 1, doubtId: 'a', cited: false },
      { ...base, index: 2, doubtId: 'b', cited: true },
      { ...base, index: 3, doubtId: 'c', cited: true }
    ])
    expect(ordered.map((source) => `${source.index}:${source.doubtId}`)).toEqual(['2:b', '3:c', '1:a'])
  })
})
