import type { GitHub } from './github'
import type { PrReviewers } from '../shared/types'
import { isReviewerName, parseCodeowners, suggestReviewers } from '../shared/reviewers'

// GitHub reads CODEOWNERS from the first of these that exists on the base branch.
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']

interface GhUser {
  login: string
  avatar_url: string
}

// Recent reviewers and who can be requested, in one small GraphQL query instead of a REST call per past PR.
const PEOPLE_QUERY = `
query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  pullRequests(last: 20, states: MERGED) { nodes { reviews(first: 10) { nodes { author { login } } } } }
  assignableUsers(first: 50) { nodes { login } }
} }`

interface GqlPeople {
  repository: {
    pullRequests: { nodes: { reviews: { nodes: { author: { login: string } | null }[] } }[] }
    assignableUsers: { nodes: { login: string }[] }
  } | null
}

async function codeowners(gh: GitHub, repo: string, base: string): Promise<{ path: string; text: string } | null> {
  for (const path of CODEOWNERS_PATHS) {
    try {
      const file = await gh.get<{ content: string }>(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(base)}`)
      return { path, text: Buffer.from(file.content, 'base64').toString('utf8') }
    } catch {
      // not at this path; try the next
    }
  }
  return null
}

export async function fetchPrReviewers(gh: GitHub, repo: string, num: number): Promise<PrReviewers> {
  const base = `/repos/${repo}/pulls/${num}`
  const [owner, name] = repo.split('/')
  const pr = await gh.get<{ user: GhUser; base: { ref: string } }>(base)
  const [requested, reviews, files, owners, people] = await Promise.all([
    gh.get<{ users: GhUser[]; teams: { slug: string }[] }>(`${base}/requested_reviewers`),
    gh.get<{ user: GhUser | null; state: string }[]>(`${base}/reviews?per_page=100`),
    gh.get<{ filename: string }[]>(`${base}/files?per_page=100`),
    codeowners(gh, repo, pr.base.ref),
    // Suggestions are a nicety: a token without GraphQL access still gets code owners.
    gh.graphql<GqlPeople>(PEOPLE_QUERY, { owner, name }).catch(() => ({ repository: null }) as GqlPeople)
  ])

  // Each reviewer's latest review counts; a plain comment doesn't override an approval or a change request.
  const latest = new Map<string, { login: string; avatar: string; state: string }>()
  for (const r of reviews) {
    if (!r.user || r.state === 'PENDING') continue
    const prev = latest.get(r.user.login)
    if (prev && r.state === 'COMMENTED' && prev.state !== 'COMMENTED') continue
    latest.set(r.user.login, { login: r.user.login, avatar: r.user.avatar_url, state: r.state })
  }
  const requestedList = [
    ...requested.users.map((u) => ({ login: u.login, team: false })),
    ...requested.teams.map((t) => ({ login: `${owner}/${t.slug}`, team: true }))
  ]
  const repoInfo = people.repository
  const suggestions = suggestReviewers({
    files: files.map((f) => f.filename),
    codeowners: owners ? parseCodeowners(owners.text) : [],
    recentReviewers: (repoInfo?.pullRequests.nodes ?? [])
      .slice()
      .reverse()
      .flatMap((p) => p.reviews.nodes.map((r) => r.author?.login).filter((l): l is string => !!l)),
    collaborators: repoInfo?.assignableUsers.nodes.map((u) => u.login) ?? [],
    author: pr.user.login,
    exclude: [...requestedList.map((r) => r.login), ...latest.keys()]
  })
  return { requested: requestedList, reviewed: [...latest.values()], suggestions, codeowners: owners?.path ?? null }
}

/** Requests or withdraws reviews. Teams (org/slug) go in team_reviewers by slug; their org must be the repo's owner. */
export async function setReviewers(gh: GitHub, repo: string, num: number, names: unknown, remove: boolean): Promise<void> {
  if (!Array.isArray(names) || !names.length || !names.every((n) => typeof n === 'string' && isReviewerName(n))) throw new Error('Not a GitHub user or team name')
  const owner = repo.split('/')[0].toLowerCase()
  const reviewers = names.filter((n) => !n.includes('/'))
  const teams = names.filter((n) => n.includes('/'))
  if (teams.some((t) => t.split('/')[0].toLowerCase() !== owner)) throw new Error(`Only teams in ${repo.split('/')[0]} can review this PR`)
  await gh.send(remove ? 'DELETE' : 'POST', `/repos/${repo}/pulls/${num}/requested_reviewers`, {
    reviewers,
    team_reviewers: teams.map((t) => t.split('/')[1])
  })
}
