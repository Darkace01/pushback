import { describe, expect, it } from 'vitest'
import { isReviewerName, ownersOf, parseCodeowners, patternToRegex, suggestReviewers } from '../../src/shared/reviewers'

const matches = (pattern: string, path: string) => patternToRegex(pattern).test(path)

describe('CODEOWNERS patterns', () => {
  it('matches a bare name at any depth', () => {
    expect(matches('*.js', 'a.js')).toBe(true)
    expect(matches('*.js', 'src/deep/a.js')).toBe(true)
    expect(matches('*.js', 'a.ts')).toBe(false)
    expect(matches('docs', 'src/docs/readme.md')).toBe(true)
  })

  it('anchors patterns with a leading or inner slash to the root', () => {
    expect(matches('/build/', 'build/out.txt')).toBe(true)
    expect(matches('/build/', 'src/build/out.txt')).toBe(false)
    expect(matches('docs/*.md', 'docs/a.md')).toBe(true)
    expect(matches('docs/*.md', 'docs/sub/a.md')).toBe(false)
    expect(matches('docs/*.md', 'x/docs/a.md')).toBe(false)
  })

  it('treats ** as any number of folders', () => {
    expect(matches('**/logs', 'logs/a')).toBe(true)
    expect(matches('**/logs', 'a/b/logs/c')).toBe(true)
    expect(matches('/src/**/test.ts', 'src/test.ts')).toBe(true)
    expect(matches('/src/**/test.ts', 'src/a/b/test.ts')).toBe(true)
    expect(matches('/apps/**', 'apps/web/index.ts')).toBe(true)
  })

  it('escapes regex characters', () => {
    expect(matches('a+b.txt', 'a+b.txt')).toBe(true)
    expect(matches('a+b.txt', 'aab.txt')).toBe(false)
  })
})

describe('parseCodeowners', () => {
  const rules = parseCodeowners(`# Default owners
*            @octo
/src/        @bob @acme/frontend   # UI code
/src/vendor/
*.md         docs@example.com @carol
`)

  it('reads owners, drops comments and email owners', () => {
    expect(rules.map((r) => [r.pattern, r.owners])).toEqual([
      ['*', ['octo']],
      ['/src/', ['bob', 'acme/frontend']],
      ['/src/vendor/', []],
      ['*.md', ['carol']]
    ])
  })

  it('uses the last matching rule, including ones that clear ownership', () => {
    expect(ownersOf(rules, 'package.json')).toEqual(['octo'])
    expect(ownersOf(rules, 'src/login.ts')).toEqual(['bob', 'acme/frontend'])
    expect(ownersOf(rules, 'src/vendor/lib.js')).toEqual([])
    expect(ownersOf(rules, 'src/README.md')).toEqual(['carol'])
  })
})

describe('suggestReviewers', () => {
  const codeowners = parseCodeowners('* @octo\n/src/ @bob @acme/frontend\n/docs/ @carol\n')

  it('ranks code owners by files owned, then recent reviewers, then collaborators, without repeats', () => {
    const out = suggestReviewers({
      files: ['src/a.ts', 'src/b.ts', 'docs/x.md', 'README.md'],
      codeowners,
      recentReviewers: ['dave', 'bob', 'dave', 'erin'],
      collaborators: ['alice', 'bob', 'frank', 'Dave'],
      author: 'alice',
      exclude: []
    })
    expect(out.map((s) => [s.login, s.reason, s.team])).toEqual([
      ['bob', 'owner', false],
      ['acme/frontend', 'owner', true],
      ['carol', 'owner', false],
      ['octo', 'owner', false],
      ['dave', 'recent', false],
      ['erin', 'recent', false],
      ['frank', 'collaborator', false]
    ])
    expect(out[0].detail).toBe('Code owner of 2 changed files, reviewed 1 recent PR')
    expect(out[4].detail).toBe('Reviewed 2 recent PRs')
  })

  it('leaves out the author and anyone already requested or reviewed, ignoring case', () => {
    const out = suggestReviewers({
      files: ['src/a.ts'],
      codeowners,
      recentReviewers: ['Carol'],
      collaborators: ['ALICE', 'zed'],
      author: 'alice',
      exclude: ['BOB', 'carol']
    })
    expect(out.map((s) => s.login)).toEqual(['acme/frontend', 'zed'])
  })

  it('still suggests people when the repo has no CODEOWNERS', () => {
    const out = suggestReviewers({ files: ['a'], codeowners: [], recentReviewers: [], collaborators: ['bob'], author: 'alice', exclude: [] })
    expect(out).toEqual([{ login: 'bob', team: false, reason: 'collaborator', detail: 'Collaborator' }])
  })
})

describe('isReviewerName', () => {
  it('accepts logins and org/team slugs only', () => {
    for (const ok of ['octo', 'a-b', 'acme/frontend', 'acme/team.name_2']) expect(isReviewerName(ok)).toBe(true)
    for (const bad of ['', '-x', 'a b', '../x', 'acme/', 'a/b/c', 'x'.repeat(40)]) expect(isReviewerName(bad)).toBe(false)
  })
})
