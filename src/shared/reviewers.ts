// Reviewer suggestions for a pull request: code owners of the changed files (from CODEOWNERS), people who
// reviewed recent PRs in the repo, and anyone else who can be requested. Pure, so it is unit-tested without GitHub.

import type { ReviewerSuggestion } from './types'

export interface OwnerRule {
  pattern: string
  /** Logins (no @) and teams as org/slug. Email owners are dropped: GitHub can't be asked to request those. */
  owners: string[]
  test: RegExp
}

/** Turns one CODEOWNERS pattern (gitignore syntax) into a regex over repo-relative paths. */
export function patternToRegex(pattern: string): RegExp {
  let p = pattern
  // A slash at the start or in the middle anchors the pattern to the repo root; otherwise it matches at any depth.
  const anchored = p.startsWith('/') || p.replace(/\/$/, '').includes('/')
  p = p.replace(/^\//, '')
  const dirOnly = p.endsWith('/')
  p = p.replace(/\/$/, '')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*' && p[i + 1] === '*') {
      // "**/" matches any number of folders, a trailing "**" everything inside.
      if (p[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  // A pattern naming a folder owns everything below it; a file pattern also matches a folder of that name.
  const tail = dirOnly ? '/.*' : '(?:/.*)?'
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}${tail}$`)
}

export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue
    const [pattern, ...owners] = line.split(/\s+/)
    // Lines with no owners are valid: they clear ownership for those paths (the last match wins).
    rules.push({ pattern, owners: owners.filter((o) => o.startsWith('@')).map((o) => o.slice(1)), test: patternToRegex(pattern) })
  }
  return rules
}

/** The owners of one path: the last matching rule wins, as on GitHub. */
export function ownersOf(rules: OwnerRule[], path: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) if (rules[i].test.test(path)) return rules[i].owners
  return []
}

export interface SuggestInput {
  files: string[]
  codeowners: OwnerRule[]
  /** Logins of people who reviewed recent PRs, most recent first, repeats allowed (more reviews rank higher). */
  recentReviewers: string[]
  /** People who can be requested (GitHub's assignable users). */
  collaborators: string[]
  /** The PR's author, who can't review their own PR. */
  author: string
  /** Already requested, or already reviewed: left out of the suggestions. */
  exclude: string[]
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Code owners first (most files owned first), then recent reviewers (most reviews first), then other collaborators. */
export function suggestReviewers(input: SuggestInput): ReviewerSuggestion[] {
  const skip = (login: string) => same(login, input.author) || input.exclude.some((x) => same(x, login))
  const out = new Map<string, ReviewerSuggestion>()

  const owned = new Map<string, number>()
  for (const file of input.files) for (const owner of ownersOf(input.codeowners, file)) owned.set(owner, (owned.get(owner) ?? 0) + 1)
  for (const [owner, files] of [...owned].sort((a, b) => b[1] - a[1])) {
    if (skip(owner)) continue
    const team = owner.includes('/')
    out.set(owner.toLowerCase(), { login: owner, team, reason: 'owner', detail: `Code owner of ${files} changed file${files === 1 ? '' : 's'}` })
  }

  const reviews = new Map<string, number>()
  for (const login of input.recentReviewers) reviews.set(login, (reviews.get(login) ?? 0) + 1)
  for (const [login, n] of [...reviews].sort((a, b) => b[1] - a[1])) {
    if (skip(login)) continue
    const key = login.toLowerCase()
    const prev = out.get(key)
    if (prev) prev.detail += `, reviewed ${n} recent PR${n === 1 ? '' : 's'}`
    else out.set(key, { login, team: false, reason: 'recent', detail: `Reviewed ${n} recent PR${n === 1 ? '' : 's'}` })
  }

  for (const login of input.collaborators) {
    const key = login.toLowerCase()
    if (skip(login) || out.has(key)) continue
    out.set(key, { login, team: false, reason: 'collaborator', detail: 'Collaborator' })
  }
  return [...out.values()]
}

/** A GitHub login, or a team as org/slug. Anything else is refused before it reaches GitHub. */
export function isReviewerName(name: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]{1,100})?$/.test(name)
}
