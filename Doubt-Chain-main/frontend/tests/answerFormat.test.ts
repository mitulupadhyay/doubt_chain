import { describe, it, expect } from 'vitest'
import { citedSourceIndexes, parseAnswerBlocks, parseInline } from '../src/lib/answerFormat'

describe('AI answer formatting', () => {
  it('parses fenced code blocks with a language', () => {
    const blocks = parseAnswerBlocks('Intro line\n\n```js\nconst a = 1\nreturn a\n```\n\nDone.')
    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'Intro line' })
    expect(blocks[1]).toEqual({ type: 'code', language: 'js', code: 'const a = 1\nreturn a' })
    expect(blocks[2]).toEqual({ type: 'paragraph', text: 'Done.' })
  })

  it('keeps an unterminated code fence instead of dropping content', () => {
    const blocks = parseAnswerBlocks('```\nunfinished')
    expect(blocks).toEqual([{ type: 'code', language: null, code: 'unfinished' }])
  })

  it('parses headings, bullet lists and numbered steps', () => {
    const blocks = parseAnswerBlocks('## Cause\n- pointer wraps\n- count missing\n\n1. Check rear\n2. Check count')
    expect(blocks[0]).toEqual({ type: 'heading', level: 2, text: 'Cause' })
    expect(blocks[1]).toEqual({ type: 'list', ordered: false, items: ['pointer wraps', 'count missing'] })
    expect(blocks[2]).toEqual({ type: 'list', ordered: true, items: ['Check rear', 'Check count'] })
  })

  it('merges wrapped continuation lines into the current list item', () => {
    const blocks = parseAnswerBlocks('1. First step that wraps\nonto a second line\n2. Second step')
    expect(blocks[0]).toMatchObject({
      type: 'list',
      ordered: true,
      items: ['First step that wraps onto a second line', 'Second step']
    })
  })

  it('never emits HTML — everything is structured data', () => {
    const blocks = parseAnswerBlocks('<script>alert(1)</script>')
    expect(blocks[0].type).toBe('paragraph')
    expect(JSON.stringify(blocks)).toContain('<script>alert(1)</script>')
  })
})

describe('Inline formatting', () => {
  it('splits bold, inline code and citation markers', () => {
    const tokens = parseInline('Use **count** with `rear` [S2].')
    expect(tokens).toEqual([
      { type: 'text', value: 'Use ' },
      { type: 'bold', value: 'count' },
      { type: 'text', value: ' with ' },
      { type: 'code', value: 'rear' },
      { type: 'text', value: ' ' },
      { type: 'citation', index: 2, raw: '[S2]' },
      { type: 'text', value: '.' }
    ])
  })

  it('collects unique citation indexes in order', () => {
    expect(citedSourceIndexes('a [S2] b [S1] c [S2]')).toEqual([1, 2])
    expect(citedSourceIndexes('no citations here')).toEqual([])
  })
})
