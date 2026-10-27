import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  expandQuery,
  normalizeQuery,
  tokenize,
  contentTokens
} from '../src/services/search/text.js'

describe('Multilingual query analysis', () => {
  it('detects English queries', () => {
    expect(detectLanguage('Why does my circular queue overflow?')).toBe('en')
    expect(detectLanguage('Explain recursion with an example')).toBe('en')
  })

  it('detects Devanagari Hindi queries', () => {
    expect(detectLanguage('सर्कुलर क्यू पूरा क्यों दिखा रहा है?')).toBe('hi')
    expect(detectLanguage('पुनरावृत्ति कैसे काम करती है')).toBe('hi')
  })

  it('detects Hinglish queries', () => {
    expect(detectLanguage('mera circular queue full kyu dikha raha hai')).toBe('hinglish')
    expect(detectLanguage('recursion kaise kaam karta hai batao')).toBe('hinglish')
  })

  it('normalises whitespace and case without dropping code characters', () => {
    expect(normalizeQuery('   Why   does  C++  fail?  ')).toBe('why does c++ fail?')
    expect(tokenize('C++ pointer & *ptr')).toContain('c++')
  })

  it('drops filler words from content tokens', () => {
    expect(contentTokens('Kya hai ye queue ka problem')).not.toContain('hai')
    expect(contentTokens('Kya hai ye queue ka problem')).toEqual(
      expect.arrayContaining(['kya', 'queue', 'problem'])
    )
  })

  it('adds English glosses for Hinglish terms', () => {
    const expanded = expandQuery('mera queue kyu full dikha raha hai')
    expect(expanded.language).toBe('hinglish')
    expect(expanded.glosses).toEqual(expect.arrayContaining(['why', 'my', 'show']))
    expect(expanded.embeddingText).toContain('English keywords:')
    expect(expanded.embeddingText.startsWith('mera queue kyu full dikha raha hai')).toBe(true)
  })

  it('adds Devanagari glosses for Hindi terms', () => {
    const expanded = expandQuery('क्यू पूरा क्यों दिख रहा है')
    expect(expanded.language).toBe('hi')
    expect(expanded.glosses).toContain('why')
  })

  it('adds native-language variants for English technical terms (both directions)', () => {
    const english = expandQuery('recursion example')
    expect(english.nativeVariants).toEqual(expect.arrayContaining(['पुनरावृत्ति']))

    const hindi = expandQuery('पुनरावृत्ति का उदाहरण')
    expect(hindi.glosses).toEqual(expect.arrayContaining(['recursion', 'example']))
  })

  it('keeps English queries unchanged for embedding', () => {
    const expanded = expandQuery('why is my stack overflow')
    expect(expanded.language).toBe('en')
    expect(expanded.embeddingText).toBe('why is my stack overflow')
  })
})
