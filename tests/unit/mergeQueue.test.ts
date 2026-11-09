import { describe, expect, it } from 'vitest'
import { formatEta, toMergeQueue, type RawMergeQueue, type RawMergeQueueEntry } from '../../src/shared/mergeQueue'
import { fetchMergeQueue } from '../../src/main/mergeQueue'
import type { GitHub } from '../../src/main/github'

const entry = (position: number, over: Partial<RawMergeQueueEntry> = {}): RawMergeQueueEntry => ({
  position,
  state: 'QUEUED',
  enqueuedAt: '2026-11-08T10:00:00Z',
  estimatedTimeToMerge: 600,
  solo: false,
  jump: false,
  enqueuer: { login: 'bob' },
  headCommit: { oid: 'f'.repeat(40) },
  pullRequest: { number: 10 + position, title: `PR ${position}`, url: `https://github.com/acme/web/pull/${10 + position}`, author: { login: 'alice', avatarUrl: 'https://a/1' } },
  ...over
})

const raw = (nodes: (RawMergeQueueEntry | null)[], over: Partial<NonNullable<RawMergeQueue['mergeQueue']>> = {}): RawMergeQueue => ({
  defaultBranchRef: { name: 'main' },
  mergeQueue: {
    url: 'https://github.com/acme/web/queue/main',
    configuration: { mergeMethod: 'SQUASH', mergingStrategy: 'ALLGREEN', maximumEntriesToBuild: 5 },
    entries: { totalCount: nodes.length, nodes },
    ...over
  }
})

describe('toMergeQueue', () => {
  it('says when a branch has no merge queue', () => {
    expect(toMergeQueue('acme/api', undefined, { defaultBranchRef: { name: 'trunk' }, mergeQueue: null })).toEqual({
      repo: 'acme/api',
      branch: 'trunk',
      enabled: false,
      entries: [],
      total: 0
    })
    expect(toMergeQueue('acme/api', 'dev', { defaultBranchRef: null, mergeQueue: null }).branch).toBe('dev')
    expect(toMergeQueue('acme/api', undefined, { defaultBranchRef: null, mergeQueue: null }).branch).toBe('')
  })

  it('maps every entry, in queue order, with its state', () => {
    const q = toMergeQueue('acme/web', undefined, raw([entry(3, { state: 'UNMERGEABLE' }), entry(1, { state: 'MERGEABLE' }), entry(2, { state: 'AWAITING_CHECKS' })]))
    expect(q.enabled).toBe(true)
    expect(q.branch).toBe('main')
    expect(q.url).toBe('https://github.com/acme/web/queue/main')
    expect(q.mergeMethod).toBe('SQUASH')
    expect(q.strategy).toBe('ALLGREEN')
    expect(q.maxBuilding).toBe(5)
    expect(q.entries.map((e) => [e.position, e.state, e.number])).toEqual([
      [1, 'mergeable', 11],
      [2, 'awaiting-checks', 12],
      [3, 'unmergeable', 13]
    ])
    expect(q.entries[0]).toEqual({
      position: 1,
      state: 'mergeable',
      number: 11,
      title: 'PR 1',
      url: 'https://github.com/acme/web/pull/11',
      author: 'alice',
      authorAvatar: 'https://a/1',
      enqueuedBy: 'bob',
      enqueuedAt: '2026-11-08T10:00:00Z',
      etaSeconds: 600,
      solo: false,
      jump: false,
      headSha: 'f'.repeat(40)
    })
  })

  it('handles queued and locked entries and states it does not know', () => {
    const q = toMergeQueue('acme/web', 'main', raw([entry(1, { state: 'LOCKED' }), entry(2), entry(3, { state: 'SOMETHING_NEW' })]))
    expect(q.entries.map((e) => e.state)).toEqual(['locked', 'queued', 'unknown'])
  })

  it('copes with missing authors, enqueuers, commits, flags and estimates', () => {
    const q = toMergeQueue(
      'acme/web',
      'main',
      raw([
        entry(1, {
          enqueuer: null,
          headCommit: null,
          solo: null,
          jump: true,
          estimatedTimeToMerge: null,
          pullRequest: { number: 5, title: 'x', url: 'u', author: null }
        })
      ])
    )
    expect(q.entries[0]).toMatchObject({ author: 'ghost', authorAvatar: '', enqueuedBy: null, headSha: null, solo: false, jump: true, etaSeconds: null })
  })

  it('skips entries whose PR is gone and keeps the total from GitHub', () => {
    const q = toMergeQueue('acme/web', 'main', raw([entry(1), null, entry(2, { pullRequest: null })], { entries: { totalCount: 140, nodes: [entry(1), null, entry(2, { pullRequest: null })] } }))
    expect(q.entries).toHaveLength(1)
    expect(q.total).toBe(140)
  })

  it('never reports fewer entries in total than it shows, and tolerates no configuration', () => {
    const q = toMergeQueue('acme/web', 'main', raw([entry(1), entry(2)], { configuration: null, entries: { totalCount: 0, nodes: [entry(1), entry(2)] } }))
    expect(q.total).toBe(2)
    expect(q.mergeMethod).toBeUndefined()
    expect(q.strategy).toBeUndefined()
    expect(q.maxBuilding).toBeUndefined()
  })
})

describe('formatEta', () => {
  it('reads like a person would say it', () => {
    expect(formatEta(null)).toBe('')
    expect(formatEta(-5)).toBe('')
    expect(formatEta(0)).toBe('under a minute')
    expect(formatEta(59)).toBe('under a minute')
    expect(formatEta(300)).toBe('about 5 min')
    expect(formatEta(3600)).toBe('about 1 h')
    expect(formatEta(4800)).toBe('about 1 h 20 min')
  })
})

describe('fetchMergeQueue', () => {
  const fake = (repository: RawMergeQueue | null) => {
    const calls: { query: string; vars: Record<string, unknown> }[] = []
    const gh = {
      graphql: async (query: string, vars: Record<string, unknown>) => {
        calls.push({ query, vars })
        return { repository }
      }
    } as unknown as GitHub
    return { gh, calls }
  }

  it('asks for the given branch, or the default branch when none is given', async () => {
    const { gh, calls } = fake(raw([entry(1)]))
    const q = await fetchMergeQueue(gh, 'acme/web', 'release')
    expect(q.branch).toBe('release')
    expect(calls[0].vars).toEqual({ owner: 'acme', name: 'web', branch: 'release' })
    expect(calls[0].query).toContain('mergeQueue(branch: $branch)')
    await fetchMergeQueue(gh, 'acme/web')
    expect(calls[1].vars.branch).toBeNull()
  })

  it('fails clearly when the repo is missing', async () => {
    await expect(fetchMergeQueue(fake(null).gh, 'acme/nope')).rejects.toThrow('acme/nope was not found')
  })
})
