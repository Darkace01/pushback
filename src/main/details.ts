import type { GitHub } from './github'
import type { PrComment, PrDetail, RepoInfo } from '../shared/types'

// Asks GitHub to render markdown bodies to sanitised HTML (body_html) alongside the raw text.
const HTML = 'application/vnd.github.html+json'

interface GhUser {
  login: string
  avatar_url: string
}

interface GhPull {
  title: string
  html_url: string
  state: 'open' | 'closed'
  merged: boolean
  draft: boolean
  user: GhUser
  created_at: string
  base: { ref: string }
  head: { ref: string; sha: string }
  body_html?: string
  additions: number
  deletions: number
  changed_files: number
  mergeable_state: string
  labels: { name: string; color: string }[]
  requested_reviewers: GhUser[]
}

interface GhComment {
  user: GhUser | null
  created_at?: string
  submitted_at?: string
  body_html?: string
  html_url: string
  state?: string
}

/** Everything the PR view shows, in one round of parallel requests. */
export async function fetchPrDetail(gh: GitHub, repo: string, num: number): Promise<PrDetail> {
  const base = `/repos/${repo}`
  const pr = await gh.get<GhPull>(`${base}/pulls/${num}`, HTML)
  const [comments, reviews, commits, files, checks] = await Promise.all([
    gh.get<GhComment[]>(`${base}/issues/${num}/comments?per_page=100`, HTML),
    gh.get<GhComment[]>(`${base}/pulls/${num}/reviews?per_page=100`, HTML),
    gh.get<{ sha: string; commit: { message: string; author: { name: string; date: string } }; author: GhUser | null }[]>(
      `${base}/pulls/${num}/commits?per_page=100`
    ),
    gh.get<{ filename: string; status: string; additions: number; deletions: number; patch?: string }[]>(`${base}/pulls/${num}/files?per_page=100`),
    gh
      .get<{ check_runs: { name: string; status: string; conclusion: string | null; html_url: string }[] }>(
        `${base}/commits/${pr.head.sha}/check-runs?per_page=100`
      )
      .catch(() => ({ check_runs: [] })) // fine-grained tokens may lack the checks permission
  ])

  const toComment = (c: GhComment): PrComment => ({
    author: c.user?.login ?? 'ghost',
    authorAvatar: c.user?.avatar_url ?? '',
    createdAt: c.submitted_at ?? c.created_at ?? '',
    bodyHtml: c.body_html ?? '',
    url: c.html_url,
    reviewState: c.state
  })
  // Reviews with no text are just state changes ("approved"); keep them, they matter in a timeline.
  const timeline = [...comments.map(toComment), ...reviews.filter((r) => r.state !== 'PENDING').map(toComment)].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  )

  return {
    repo,
    number: num,
    title: pr.title,
    url: pr.html_url,
    state: pr.merged ? 'merged' : pr.state,
    isDraft: pr.draft,
    author: pr.user.login,
    authorAvatar: pr.user.avatar_url,
    createdAt: pr.created_at,
    base: pr.base.ref,
    head: pr.head.ref,
    bodyHtml: pr.body_html ?? '',
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    mergeableState: pr.mergeable_state,
    labels: pr.labels.map((l) => ({ name: l.name, color: l.color })),
    requestedReviewers: pr.requested_reviewers.map((u) => u.login),
    headSha: pr.head.sha,
    comments: timeline,
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login ?? c.commit.author.name,
      authorAvatar: c.author?.avatar_url,
      date: c.commit.author.date
    })),
    files,
    checks: checks.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url }))
  }
}

export async function fetchRepoInfo(gh: GitHub, repo: string): Promise<RepoInfo> {
  const [r, readme] = await Promise.all([
    gh.get<{
      full_name: string
      description: string | null
      html_url: string
      homepage: string | null
      private: boolean
      archived: boolean
      default_branch: string
      language: string | null
      stargazers_count: number
      forks_count: number
      open_issues_count: number
      topics?: string[]
      pushed_at: string
    }>(`/repos/${repo}`),
    gh.text(`/repos/${repo}/readme`, 'application/vnd.github.html').catch(() => null) // no README is normal
  ])
  return {
    fullName: r.full_name,
    description: r.description,
    url: r.html_url,
    homepage: r.homepage || null,
    private: r.private,
    archived: r.archived,
    defaultBranch: r.default_branch,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    topics: r.topics ?? [],
    pushedAt: r.pushed_at,
    readmeHtml: readme
  }
}
