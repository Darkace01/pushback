import { describe, expect, it } from 'vitest'
import type { GitHub } from '../../src/main/github'
import { artifactFileName, listArtifacts, reviewDeployments } from '../../src/main/runExtras'
import { commentLine, replyToThread, resolveThread, toThread, type GqlThread } from '../../src/main/reviewThreads'

/** Records writes and answers GETs from a map, standing in for the GitHub client. */
function fakeGh(gets: Record<string, unknown> = {}) {
  const sent: { method: string; path: string; body?: unknown }[] = []
  const queries: { query: string; vars: Record<string, unknown> }[] = []
  const gh = {
    get: async (path: string) => gets[path],
    send: async (method: string, path: string, body?: unknown) => (sent.push({ method, path, body }), null),
    graphql: async (query: string, vars: Record<string, unknown>) => (queries.push({ query, vars }), {})
  } as unknown as GitHub
  return { gh, sent, queries }
}

describe('reviewDeployments', () => {
  it('sends the environments, state and comment', async () => {
    const { gh, sent } = fakeGh()
    await reviewDeployments(gh, 'acme/api', 104, [7, 8], 'approved', ' ship it ')
    expect(sent).toEqual([{ method: 'POST', path: '/repos/acme/api/actions/runs/104/pending_deployments', body: { environment_ids: [7, 8], state: 'approved', comment: 'ship it' } }])
  })
  it('fills in the comment GitHub requires', async () => {
    const { gh, sent } = fakeGh()
    await reviewDeployments(gh, 'acme/api', 1, [7], 'rejected', '')
    expect((sent[0].body as { comment: string }).comment).toBe('Rejected in Pushback')
  })
  it('refuses bad input instead of sending it', async () => {
    const { gh, sent } = fakeGh()
    await expect(reviewDeployments(gh, 'acme/api', 1, [], 'approved', '')).rejects.toThrow('environment')
    await expect(reviewDeployments(gh, 'acme/api', 1, [1], 'maybe' as 'approved', '')).rejects.toThrow('state')
    expect(sent).toEqual([])
  })
})

describe('artifacts', () => {
  it('lists a run\'s artifacts', async () => {
    const { gh } = fakeGh({
      '/repos/acme/api/actions/runs/5/artifacts?per_page=100': {
        artifacts: [{ id: 1, name: 'dist', size_in_bytes: 2048, expired: false, created_at: 'c', expires_at: 'e' }]
      }
    })
    expect(await listArtifacts(gh, 'acme/api', 5)).toEqual([{ id: 1, name: 'dist', size: 2048, expired: false, createdAt: 'c', expiresAt: 'e' }])
  })
  it('makes a safe file name', () => {
    expect(artifactFileName('build/output:win*')).toBe('build_output_win_.zip')
    expect(artifactFileName('..')).toBe('artifact.zip')
    expect(artifactFileName('coverage')).toBe('coverage.zip')
  })
})

describe('review threads', () => {
  const thread: GqlThread = {
    id: 'T1', isResolved: false, isOutdated: false, path: 'src/a.ts', line: 4, originalLine: 4, diffSide: 'RIGHT',
    comments: { nodes: [{ databaseId: 11, bodyHTML: '<p>hi</p>', createdAt: 'd', url: 'u', author: { login: 'bob', avatarUrl: 'av' } }, { databaseId: 12, bodyHTML: '', createdAt: 'd', url: 'u', author: null }] }
  }
  it('maps a thread, and treats outdated ones as having no line', () => {
    expect(toThread(thread)).toEqual({
      id: 'T1', path: 'src/a.ts', line: 4, side: 'RIGHT', resolved: false, outdated: false,
      comments: [{ id: 11, author: 'bob', authorAvatar: 'av', bodyHtml: '<p>hi</p>', createdAt: 'd', url: 'u' }, { id: 12, author: 'ghost', authorAvatar: '', bodyHtml: '', createdAt: 'd', url: 'u' }]
    })
    expect(toThread({ ...thread, isOutdated: true })).toMatchObject({ line: null, outdated: true })
  })
  it('comments on a line of the head commit', async () => {
    const { gh, sent } = fakeGh()
    await commentLine(gh, 'acme/api', 7, { path: 'src/a.ts', line: 3, side: 'LEFT', body: ' nit ', commitId: 'b'.repeat(40) })
    expect(sent).toEqual([{ method: 'POST', path: '/repos/acme/api/pulls/7/comments', body: { body: 'nit', commit_id: 'b'.repeat(40), path: 'src/a.ts', line: 3, side: 'LEFT' } }])
  })
  it('refuses empty comments, unknown commits and bad lines', () => {
    const { gh } = fakeGh()
    const c = { path: 'a', line: 1, side: 'RIGHT' as const, body: 'x', commitId: 'b'.repeat(40) }
    expect(() => commentLine(gh, 'acme/api', 7, { ...c, body: '  ' })).toThrow()
    expect(() => commentLine(gh, 'acme/api', 7, { ...c, commitId: 'main' })).toThrow()
    expect(() => commentLine(gh, 'acme/api', 7, { ...c, line: 0 })).toThrow()
  })
  it('replies and resolves', async () => {
    const { gh, sent, queries } = fakeGh()
    await replyToThread(gh, 'acme/api', 7, 11, 'done')
    await resolveThread(gh, 'T1', true)
    await resolveThread(gh, 'T1', false)
    expect(sent).toEqual([{ method: 'POST', path: '/repos/acme/api/pulls/7/comments/11/replies', body: { body: 'done' } }])
    expect(queries.map((q) => [q.query.match(/(un)?resolveReviewThread/)![0], q.vars])).toEqual([
      ['resolveReviewThread', { id: 'T1' }],
      ['unresolveReviewThread', { id: 'T1' }]
    ])
  })
})
