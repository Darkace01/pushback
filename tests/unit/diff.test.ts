import { describe, expect, it } from 'vitest'
import { anchorOf, parsePatch, suggestionFor } from '../../src/shared/diff'

const PATCH = ['@@ -10,4 +10,5 @@ function f() {', ' keep', '-old', '+new', '+added', ' tail', '\\ No newline at end of file', '@@ -40,1 +41,1 @@', '-x', '+y'].join('\n')

describe('parsePatch', () => {
  it('numbers lines on both sides from each hunk header', () => {
    const lines = parsePatch(PATCH)
    expect(lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['hunk', undefined, undefined],
      ['ctx', 10, 10],
      ['del', 11, undefined],
      ['add', undefined, 11],
      ['add', undefined, 12],
      ['ctx', 12, 13],
      ['meta', undefined, undefined],
      ['hunk', undefined, undefined],
      ['del', 40, undefined],
      ['add', undefined, 41]
    ])
  })
  it('handles single-line hunk headers and missing patches', () => {
    expect(parsePatch('@@ -0,0 +1 @@\n+only').map((l) => l.newLine)).toEqual([undefined, 1])
    expect(parsePatch(undefined)).toEqual([])
  })
})

describe('anchorOf', () => {
  const [hunk, ctx, del, add] = parsePatch(PATCH)
  it('puts deleted lines on the LEFT and everything else on the RIGHT', () => {
    expect(anchorOf(del)).toEqual({ line: 11, side: 'LEFT' })
    expect(anchorOf(add)).toEqual({ line: 11, side: 'RIGHT' })
    expect(anchorOf(ctx)).toEqual({ line: 10, side: 'RIGHT' })
    expect(anchorOf(hunk)).toBeNull()
  })
})

describe('suggestionFor', () => {
  const [, ctx, del, add] = parsePatch(PATCH)
  it('wraps the new-side line in a suggestion block', () => {
    expect(suggestionFor(add)).toBe('```suggestion\nnew\n```')
    expect(suggestionFor(ctx)).toBe('```suggestion\nkeep\n```')
    expect(suggestionFor(del)).toBeNull()
  })
})
