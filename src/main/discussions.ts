import type { DiscussionCategory, DiscussionComment, DiscussionDetail, DiscussionSummary, RepoDiscussions } from '../shared/types'
import type { GitHub } from './github'

// GitHub Discussions, read through GraphQL (there's no REST list). Loaded when the Discussions section or a
// discussion view opens; never polled.

const SUMMARY_FIELDS = `number title url createdAt updatedAt upvoteCount closed isAnswered
  author { login avatarUrl }
  category { id name isAnswerable }
  comments { totalCount }`

export const DISCUSSIONS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    hasDiscussionsEnabled
    discussionCategories(first: 25) { nodes { id name isAnswerable } }
    discussions(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${SUMMARY_FIELDS} } }
  }
}`

const COMMENT_FIELDS = `id url bodyHTML createdAt author { login avatarUrl }`

export const DISCUSSION_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      id bodyHTML locked ${SUMMARY_FIELDS}
      comments(first: 50) { nodes { ${COMMENT_FIELDS} isAnswer replies(first: 20) { nodes { ${COMMENT_FIELDS} } } } }
    }
  }
}`

type Author = { login: string; avatarUrl: string } | null

export interface SummaryNode {
  number: number
  title: string
  url: string
  createdAt: string
  updatedAt: string
  upvoteCount: number
  closed: boolean
  isAnswered: boolean | null
  author: Author
  category: DiscussionCategory
  comments: { totalCount: number }
}

interface CommentNode {
  id: string
  url: string
  bodyHTML: string
  createdAt: string
  author: Author
  isAnswer?: boolean
  replies?: { nodes: (CommentNode | null)[] }
}

export interface DetailNode extends SummaryNode {
  id: string
  bodyHTML: string
  locked: boolean
  comments: SummaryNode['comments'] & { nodes?: (CommentNode | null)[] }
}

export function toDiscussion(d: SummaryNode): DiscussionSummary {
  return {
    number: d.number,
    title: d.title,
    url: d.url,
    author: d.author?.login ?? 'ghost',
    authorAvatar: d.author?.avatarUrl ?? '',
    category: { id: d.category.id, name: d.category.name, isAnswerable: d.category.isAnswerable },
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    comments: d.comments.totalCount,
    upvotes: d.upvoteCount,
    // "Answered" only means something in Q&A categories.
    answered: d.category.isAnswerable ? !!d.isAnswered : null,
    closed: d.closed
  }
}

const toComment = (c: CommentNode): DiscussionComment => ({
  id: c.id,
  author: c.author?.login ?? 'ghost',
  authorAvatar: c.author?.avatarUrl ?? '',
  createdAt: c.createdAt,
  bodyHtml: c.bodyHTML ?? '',
  url: c.url,
  isAnswer: !!c.isAnswer,
  replies: (c.replies?.nodes ?? []).filter((r): r is CommentNode => !!r).map(toComment)
})

export function toDiscussionDetail(d: DetailNode): DiscussionDetail {
  const { comments: commentCount, ...summary } = toDiscussion(d)
  return {
    ...summary,
    commentCount,
    id: d.id,
    bodyHtml: d.bodyHTML ?? '',
    locked: d.locked,
    comments: (d.comments.nodes ?? []).filter((c): c is CommentNode => !!c).map(toComment)
  }
}

type ListData = {
  repository: {
    hasDiscussionsEnabled: boolean
    discussionCategories: { nodes: (DiscussionCategory | null)[] } | null
    discussions: { nodes: (SummaryNode | null)[] } | null
  } | null
}

export function readDiscussions(repo: string, data: ListData): RepoDiscussions {
  const r = data.repository
  if (!r) throw new Error(`${repo} was not found, or your token can't see it`)
  if (!r.hasDiscussionsEnabled) return { enabled: false, categories: [], discussions: [] }
  return {
    enabled: true,
    categories: (r.discussionCategories?.nodes ?? []).filter((c): c is DiscussionCategory => !!c),
    discussions: (r.discussions?.nodes ?? []).filter((d): d is SummaryNode => !!d).map(toDiscussion)
  }
}

export async function listDiscussions(gh: GitHub, repo: string): Promise<RepoDiscussions> {
  const [owner, name] = repo.split('/')
  return readDiscussions(repo, await gh.graphql<ListData>(DISCUSSIONS_QUERY, { owner, name }))
}

export async function discussionDetail(gh: GitHub, repo: string, num: number): Promise<DiscussionDetail> {
  const [owner, name] = repo.split('/')
  const data = await gh.graphql<{ repository: { discussion: DetailNode | null } | null }>(DISCUSSION_QUERY, { owner, name, number: num })
  const d = data.repository?.discussion
  if (!d) throw new Error(`Discussion #${num} was not found in ${repo}`)
  return toDiscussionDetail(d)
}

const ADD_COMMENT = `mutation($id: ID!, $body: String!) {
  addDiscussionComment(input: { discussionId: $id, body: $body }) { comment { id url } }
}`

export async function commentDiscussion(gh: GitHub, discussionId: string, body: string): Promise<void> {
  if (typeof discussionId !== 'string' || !discussionId || typeof body !== 'string' || !body.trim()) throw new Error('Write a comment first')
  await gh.graphql(ADD_COMMENT, { id: discussionId, body })
}
