import type { GitHub } from './github'
import type { NewLineComment, ReviewThread } from '../shared/types'

// Review threads (and whether they're resolved) only exist in GraphQL. Fetched when a PR's files are opened,
// never by the poller, so they cost nothing until someone looks.
const THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
  reviewThreads(first: 100) { nodes {
    id isResolved isOutdated path line originalLine diffSide
    comments(first: 50) { nodes { databaseId bodyHTML createdAt url author { login avatarUrl } } }
  } }
} } }`

export interface GqlThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  diffSide: 'LEFT' | 'RIGHT'
  comments: { nodes: { databaseId: number; bodyHTML: string; createdAt: string; url: string; author: { login: string; avatarUrl: string } | null }[] }
}

export function toThread(t: GqlThread): ReviewThread {
  return {
    id: t.id,
    path: t.path,
    line: t.isOutdated ? null : t.line,
    side: t.diffSide,
    resolved: t.isResolved,
    outdated: t.isOutdated || t.line === null,
    comments: t.comments.nodes.map((c) => ({
      id: c.databaseId,
      author: c.author?.login ?? 'ghost',
      authorAvatar: c.author?.avatarUrl ?? '',
      bodyHtml: c.bodyHTML,
      createdAt: c.createdAt,
      url: c.url
    }))
  }
}

export async function fetchThreads(gh: GitHub, repo: string, num: number): Promise<ReviewThread[]> {
  const [owner, name] = repo.split('/')
  const data = await gh.graphql<{ repository: { pullRequest: { reviewThreads: { nodes: GqlThread[] } } | null } | null }>(THREADS_QUERY, {
    owner,
    name,
    number: Number(num)
  })
  return (data.repository?.pullRequest?.reviewThreads.nodes ?? []).map(toThread)
}

export function commentLine(gh: GitHub, repo: string, num: number, c: NewLineComment): Promise<unknown> {
  const body = String(c.body ?? '').trim()
  if (!body) throw new Error('A comment needs some text')
  if (!/^[0-9a-f]{40}$/i.test(String(c.commitId))) throw new Error('Unknown commit')
  const line = Number(c.line)
  if (!Number.isInteger(line) || line < 1) throw new Error('Unknown line')
  const side = c.side === 'LEFT' ? 'LEFT' : 'RIGHT'
  return gh.send('POST', `/repos/${repo}/pulls/${Number(num)}/comments`, { body, commit_id: c.commitId, path: String(c.path), line, side })
}

export function replyToThread(gh: GitHub, repo: string, num: number, commentId: number, body: string): Promise<unknown> {
  const text = String(body ?? '').trim()
  if (!text) throw new Error('A reply needs some text')
  return gh.send('POST', `/repos/${repo}/pulls/${Number(num)}/comments/${Number(commentId)}/replies`, { body: text })
}

export function resolveThread(gh: GitHub, threadId: string, resolved: boolean): Promise<unknown> {
  const mutation = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
  return gh.graphql(`mutation($id: ID!) { ${mutation}(input: { threadId: $id }) { thread { id isResolved } } }`, { id: String(threadId) })
}
