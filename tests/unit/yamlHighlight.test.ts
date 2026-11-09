import { describe, expect, it } from 'vitest'
import { highlightLine, type Token } from '../../src/renderer/src/lib/yamlHighlight'

const kinds = (tokens: Token[]) => tokens.filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text.trim()}`)

describe('highlightLine', () => {
  it('keeps every character, in order', () => {
    const lines = ['on:', '  push:', "    branches: [main, 'release/**'] # comment", '      - run: echo "${{ github.sha }}"', 'x', '', '   ']
    for (const l of lines) expect(highlightLine(l).map((t) => t.text).join('')).toBe(l)
  })

  it('marks keys, list dashes and scalars', () => {
    expect(kinds(highlightLine('name: CI'))).toEqual(['key:name', 'punct::', 'plain:CI'])
    expect(kinds(highlightLine('  - uses: actions/checkout@v4'))).toEqual(['punct:-', 'key:uses', 'punct::', 'plain:actions/checkout@v4'])
    expect(kinds(highlightLine('    timeout-minutes: 10'))).toEqual(['key:timeout-minutes', 'punct::', 'literal:10'])
    expect(kinds(highlightLine('  cancel: true'))).toEqual(['key:cancel', 'punct::', 'literal:true'])
    expect(kinds(highlightLine('  run: |'))).toEqual(['key:run', 'punct::', 'punct:|'])
    expect(kinds(highlightLine('  - main'))).toEqual(['punct:-', 'plain:main'])
  })

  it('marks strings, expressions and comments', () => {
    expect(kinds(highlightLine(`  if: \${{ github.ref == 'refs/heads/main' }} # only main`))).toEqual([
      'key:if',
      'punct::',
      "expr:${{ github.ref == 'refs/heads/main' }}",
      'comment:# only main'
    ])
    expect(kinds(highlightLine(`  name: "Build #1" # real comment`))).toEqual(['key:name', 'punct::', 'string:"Build #1"', 'comment:# real comment'])
    expect(kinds(highlightLine('      - run: echo "sha ${{ github.sha }}"'))).toEqual(['punct:-', 'key:run', 'punct::', 'plain:echo', 'string:"sha', 'expr:${{ github.sha }}', 'string:"'])
    expect(kinds(highlightLine('# just a comment'))).toEqual(['comment:# just a comment'])
    expect(kinds(highlightLine("  'quoted key': x"))).toEqual(["key:'quoted key'", 'punct::', 'plain:x'])
  })

  it('does not take URLs or a # inside a word for keys or comments', () => {
    expect(kinds(highlightLine('  - https://example.com/a#b'))).toEqual(['punct:-', 'plain:https://example.com/a#b'])
    expect(kinds(highlightLine('echo "a" \\"b'))).toEqual(['plain:echo', 'string:"a"', 'plain:\\"b'])
  })
})
