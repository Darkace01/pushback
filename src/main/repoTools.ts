import type { GitHub } from './github'
import type { ActionResult, BranchInfo, CommitInfo, GraphCommit, IssueDetail, IssueSummary, Label, MergedPr, Milestone, NewPr, NewRelease, PrComment, ReleaseDraft, ReleaseInfo } from '../shared/types'

// GitHub tools for the repo workspace: issues, branches, commits, releases and creating PRs.
// Everything here is fetched on demand when a section opens, never by the poller.

const HTML = 'application/vnd.github.html+json'

/** Branch names can contain slashes, which must stay literal in /git/ref/heads/<name> URLs. */
export const refPath = (name: string) => name.split('/').map(encodeURIComponent).join('/')

interface GhUser {
  login: string
  avatar_url: string
}

interface GhIssue {
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  state_reason?: string | null
  user: GhUser | null
  created_at: string
  updated_at: string
  comments: number
  labels: (string | { name: string; color: string; description?: string | null })[]
  assignees: GhUser[] | null
  body_html?: string
  pull_request?: unknown
  milestone?: { number: number; title: string } | null
}

const toLabel = (l: GhIssue['labels'][number]): Label => (typeof l === 'string' ? { name: l, color: '888888' } : { name: l.name, color: l.color, description: l.description })

function toIssue(repo: string, i: GhIssue): IssueSummary {
  return {
    repo,
    number: i.number,
    title: i.title,
    url: i.html_url,
    state: i.state,
    author: i.user?.login ?? 'ghost',
    authorAvatar: i.user?.avatar_url ?? '',
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    comments: i.comments,
    labels: i.labels.map(toLabel),
    assignees: (i.assignees ?? []).map((a) => a.login),
    milestone: i.milestone ? { number: i.milestone.number, title: i.milestone.title } : null
  }
}

export async function listIssues(gh: GitHub, repo: string, state: 'open' | 'closed', milestone?: number | 'none'): Promise<IssueSummary[]> {
  // Filtering on GitHub's side, so a milestone's issues aren't cut off by the 100 most recently updated.
  const only = milestone === 'none' ? '&milestone=none' : Number.isInteger(milestone) ? `&milestone=${milestone}` : ''
  const items = await gh.get<GhIssue[]>(`/repos/${repo}/issues?state=${state}&sort=updated&per_page=100${only}`)
  // The issues endpoint also returns PRs; those have their own section.
  return items.filter((i) => !i.pull_request).map((i) => toIssue(repo, i))
}

export async function issueDetail(gh: GitHub, repo: string, num: number): Promise<IssueDetail> {
  const [issue, comments] = await Promise.all([
    gh.get<GhIssue>(`/repos/${repo}/issues/${num}`, HTML),
    gh.get<{ user: GhUser | null; created_at: string; body_html?: string; html_url: string }[]>(`/repos/${repo}/issues/${num}/comments?per_page=100`, HTML)
  ])
  const { comments: _count, ...summary } = toIssue(repo, issue)
  return {
    ...summary,
    bodyHtml: issue.body_html ?? '',
    stateReason: issue.state_reason ?? null,
    timeline: comments.map(
      (c): PrComment => ({ author: c.user?.login ?? 'ghost', authorAvatar: c.user?.avatar_url ?? '', createdAt: c.created_at, bodyHtml: c.body_html ?? '', url: c.html_url })
    )
  }
}

export async function listLabels(gh: GitHub, repo: string): Promise<Label[]> {
  return (await gh.get<GhIssue['labels']>(`/repos/${repo}/labels?per_page=100`)).map(toLabel)
}

const BRANCHES_QUERY = `query($owner: String!, $name: String!, $base: String!) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
      nodes {
        name
        target { ... on Commit { oid committedDate messageHeadline author { name user { login avatarUrl } } } }
        compare(headRef: $base) { aheadBy behindBy }
        associatedPullRequests(first: 1, states: OPEN) { nodes { number } }
      }
    }
  }
}`

interface RefNode {
  name: string
  target: { oid: string; committedDate: string; messageHeadline: string; author: { name: string; user: { login: string; avatarUrl: string } | null } }
  compare: { aheadBy: number; behindBy: number } | null
  associatedPullRequests: { nodes: { number: number }[] }
}

/** Branches newest first, each with ahead/behind counts against the default branch and its open PR. */
export async function listBranches(gh: GitHub, repo: string, defaultBranch: string): Promise<BranchInfo[]> {
  const [owner, name] = repo.split('/')
  const data = await gh.graphql<{ repository: { refs: { nodes: RefNode[] } } }>(BRANCHES_QUERY, { owner, name, base: defaultBranch })
  const branches = data.repository.refs.nodes.map((r) => ({
    name: r.name,
    sha: r.target.oid,
    isDefault: r.name === defaultBranch,
    date: r.target.committedDate,
    message: r.target.messageHeadline,
    author: r.target.author.user?.login ?? r.target.author.name,
    authorAvatar: r.target.author.user?.avatarUrl,
    // compare() treats this branch as the base: "aheadBy" is how far the default branch is ahead of it.
    ahead: r.compare?.behindBy ?? 0,
    behind: r.compare?.aheadBy ?? 0,
    openPr: r.associatedPullRequests.nodes[0]?.number
  }))
  // GitHub's TAG_COMMIT_DATE order isn't reliable for branches, so sort here: default first, then newest.
  return branches.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Date.parse(b.date) - Date.parse(a.date))
}

export async function createBranch(gh: GitHub, repo: string, name: string, from: string): Promise<ActionResult> {
  const ref = await gh.get<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${refPath(from)}`)
  await gh.send('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${name}`, sha: ref.object.sha })
  return { ok: true, url: `https://github.com/${repo}/tree/${name}` }
}

export async function listCommits(gh: GitHub, repo: string, ref?: string, perPage = 60): Promise<CommitInfo[]> {
  const commits = await gh.get<
    { sha: string; html_url: string; parents: { sha: string }[]; commit: { message: string; author: { name: string; date: string } }; author: GhUser | null }[]
  >(`/repos/${repo}/commits?per_page=${perPage}${ref ? `&sha=${encodeURIComponent(ref)}` : ''}`)
  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.author?.login ?? c.commit.author.name,
    authorAvatar: c.author?.avatar_url,
    date: c.commit.author.date,
    url: c.html_url,
    parents: c.parents.map((p) => p.sha)
  }))
}

/**
 * A commit graph across branches without a clone: recent commits of each branch, merged and ordered so
 * children come before parents. Costs one request per branch, so callers keep the list short.
 */
export async function branchGraph(gh: GitHub, repo: string, branches: string[]): Promise<GraphCommit[]> {
  const names = branches.slice(0, 8)
  const lists = await Promise.all(names.map((b) => listCommits(gh, repo, b, 40).catch(() => [] as CommitInfo[])))
  const bySha = new Map<string, GraphCommit>()
  lists.forEach((list, i) =>
    list.forEach((c, j) => {
      const g = bySha.get(c.sha) ?? {
        sha: c.sha,
        parents: c.parents,
        subject: c.message.split('\n')[0],
        author: c.author,
        avatar: c.authorAvatar,
        date: c.date,
        refs: [],
        url: c.url
      }
      // The first branch is the default one; label each branch at its tip.
      if (j === 0) g.refs.push(`${i === 0 ? 'head' : 'branch'}:${names[i]}`)
      bySha.set(c.sha, g)
    })
  )
  // Newest first; then, should clock skew put a parent above its child, move the parent down below it.
  const order = [...bySha.values()].sort((a, b) => b.date.localeCompare(a.date))
  for (let i = 0; i < order.length; i++) {
    const at = new Map(order.map((c, k) => [c.sha, k]))
    const p = order[i].parents.map((s) => at.get(s)).filter((k): k is number => k !== undefined && k < i)
    if (p.length) {
      const moved = order.splice(Math.min(...p), 1)[0]
      order.splice(i, 0, moved)
      i = Math.min(...p) - 1
    }
  }
  return order
}

export async function listReleases(gh: GitHub, repo: string): Promise<ReleaseInfo[]> {
  const releases = await gh.get<
    {
      id: number
      tag_name: string
      name: string | null
      html_url: string
      draft: boolean
      prerelease: boolean
      published_at: string | null
      created_at: string
      author: GhUser
      body_html?: string
      assets: { name: string; size: number; download_count: number; browser_download_url: string }[]
    }[]
  >(`/repos/${repo}/releases?per_page=30`, HTML)
  return releases.map((r) => ({
    id: r.id,
    tag: r.tag_name,
    name: r.name || r.tag_name,
    url: r.html_url,
    draft: r.draft,
    prerelease: r.prerelease,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    author: r.author.login,
    bodyHtml: r.body_html ?? '',
    assets: r.assets.map((a) => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url }))
  }))
}

export async function createRelease(gh: GitHub, repo: string, r: NewRelease): Promise<ActionResult> {
  const created = (await gh.send('POST', `/repos/${repo}/releases`, {
    tag_name: r.tag,
    target_commitish: r.target,
    name: r.name || r.tag,
    body: r.body,
    draft: r.draft,
    prerelease: r.prerelease,
    generate_release_notes: r.generateNotes
  })) as { html_url: string }
  return { ok: true, url: created.html_url }
}

export async function createIssue(gh: GitHub, repo: string, issue: { title: string; body: string; labels: string[] }): Promise<ActionResult> {
  const created = (await gh.send('POST', `/repos/${repo}/issues`, issue)) as { number: number; html_url: string }
  return { ok: true, number: created.number, url: created.html_url }
}

export async function createPr(gh: GitHub, repo: string, pr: NewPr): Promise<ActionResult> {
  const created = (await gh.send('POST', `/repos/${repo}/pulls`, pr)) as { number: number; html_url: string }
  return { ok: true, number: created.number, url: created.html_url }
}

/**
 * PRs merged into `base` since the latest published release. Uses the plain pulls list (newest-updated first,
 * ETag-cached) rather than the search API, whose rate limit is much lower, and stops after 3 pages.
 */
export async function releaseDraft(gh: GitHub, repo: string, base: string): Promise<ReleaseDraft> {
  const releases = await gh.get<{ tag_name: string; created_at: string; draft: boolean; prerelease: boolean }[]>(`/repos/${repo}/releases?per_page=30`)
  const last = releases.find((r) => !r.draft && !r.prerelease)
  const since = last ? Date.parse(last.created_at) : 0
  const prs: MergedPr[] = []
  for (let page = 1; page <= 3; page++) {
    const batch = await gh.get<
      { number: number; title: string; html_url: string; merged_at: string | null; updated_at: string; user: GhUser | null; labels: { name: string }[] }[]
    >(`/repos/${repo}/pulls?state=closed&base=${encodeURIComponent(base)}&sort=updated&direction=desc&per_page=100&page=${page}`)
    for (const p of batch) {
      if (p.merged_at && Date.parse(p.merged_at) > since) {
        prs.push({ number: p.number, title: p.title, url: p.html_url, author: p.user?.login ?? 'ghost', labels: p.labels.map((l) => l.name), mergedAt: p.merged_at })
      }
    }
    // Sorted by last update, and a PR can't be updated before it was merged: once a page ends before the release, we're done.
    if (batch.length < 100 || Date.parse(batch[batch.length - 1].updated_at) < since) break
  }
  return { since: last?.tag_name ?? null, prs }
}

export interface GhMilestone {
  number: number
  title: string
  description: string | null
  state: 'open' | 'closed'
  open_issues: number
  closed_issues: number
  due_on: string | null
  closed_at: string | null
  html_url: string
}

export const toMilestone = (m: GhMilestone): Milestone => ({
  number: m.number,
  title: m.title,
  description: m.description || null,
  state: m.state,
  openIssues: m.open_issues,
  closedIssues: m.closed_issues,
  dueOn: m.due_on,
  closedAt: m.closed_at,
  url: m.html_url
})

/** Open milestones soonest due first (undated ones last); closed ones most recently closed first. */
export async function listMilestones(gh: GitHub, repo: string, state: 'open' | 'closed'): Promise<Milestone[]> {
  const list = await gh.get<GhMilestone[]>(`/repos/${repo}/milestones?state=${state}&sort=due_on&direction=asc&per_page=100`)
  const milestones = list.map(toMilestone)
  if (state === 'closed') return milestones.sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
  return milestones.sort((a, b) => (a.dueOn ? Date.parse(a.dueOn) : Infinity) - (b.dueOn ? Date.parse(b.dueOn) : Infinity))
}

export async function setIssueMilestone(gh: GitHub, repo: string, num: number, milestone: number | null): Promise<void> {
  if (milestone !== null && !(Number.isInteger(milestone) && milestone > 0)) throw new Error('Not a milestone number')
  await gh.send('PATCH', `/repos/${repo}/issues/${num}`, { milestone })
}
