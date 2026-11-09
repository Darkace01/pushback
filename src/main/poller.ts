import { EventEmitter } from 'node:events'
import { parse as parseYaml } from 'yaml'
import type {
  AppEvent,
  ChecksState,
  DispatchInput,
  GhNotification,
  Inbox,
  InboxItem,
  PullRequest,
  RepoState,
  Settings,
  Snapshot,
  Workflow,
  WorkflowRun
} from '../shared/types'
import { pollSlowdown } from '../shared/repos'
import { environmentNames, newApprovalsForYou } from '../shared/approvals'
import { markRead, toNotification, type GhThread } from '../shared/notifications'
import { GitHub } from './github'
import { fetchApproval } from './runExtras'

const MAX_EVENTS = 300
/** Workflow definitions change rarely; refresh them every N polls. */
const WORKFLOW_REFRESH_EVERY = 10
/** After a dispatch / rerun, poll at the active rate for this long so the new run shows up quickly. */
const BOOST_MS = 90_000

type Settled<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }
type PrFetch = { defaultBranch?: string; prs: PullRequest[] }

interface Events {
  update: [Snapshot]
  events: [AppEvent[]]
}

/**
 * Stretches the poll interval when the REST budget runs low, so what's left lasts until the reset instead of
 * running dry mid-hour: remaining calls are spread over the time left, assuming a cycle costs about 20 calls.
 * A fully spent or Retry-After pause waits for its end.
 */
export function paceForBudget(ms: number, gh?: { rate?: { limit: number; remaining: number; reset: number }; restBlockedUntil(): number | undefined }, now = Date.now()): number {
  if (!gh) return ms
  const blocked = gh.restBlockedUntil()
  if (blocked) return Math.max(ms, blocked - now + 1000)
  const r = gh.rate
  if (!r || r.reset <= now || r.remaining > r.limit * 0.1) return ms
  return Math.max(ms, Math.min((r.reset - now) / Math.max(1, r.remaining) * 20, r.reset - now))
}

export class Poller extends EventEmitter<Events> {
  snapshot: Snapshot
  private gh?: GitHub
  /** Client for a repo on an extra account (undefined: use the primary). Set by the main process. */
  private resolve?: (repo: string) => GitHub | undefined
  private hasExtra = false
  private timer?: NodeJS.Timeout
  private running = false
  private queued = false
  private cycle = 0
  private boostUntil = 0
  // PRs and the inbox come from GraphQL, whose hourly budget (5,000 points) a 10-second active rate across a dozen
  // repos would spend in well under an hour. So they refresh at the normal interval, or when asked to, and the
  // fast rate only applies to runs, which are REST GETs where an unchanged answer (304) is free.
  private graphqlAt = 0
  private forceGraphql = true
  private lastInbox?: Settled<InboxFetch>
  private lastPrs = new Map<string, Settled<PrFetch>>()
  private lastNotifications?: Settled<GhNotification[]>

  constructor(
    private readonly getSettings: () => Settings,
    events: AppEvent[]
  ) {
    super()
    this.snapshot = { auth: 'missing', repos: {}, events, polling: false }
  }

  get client(): GitHub | undefined {
    return this.gh
  }

  /** Lets repos on extra accounts (GitHub Enterprise Server) be polled with their own client. */
  setResolver(resolve: (repo: string) => GitHub | undefined, hasExtra: boolean): void {
    this.resolve = resolve
    this.hasExtra = hasExtra
  }

  setClient(gh: GitHub | undefined, source?: 'pat' | 'gh'): void {
    this.gh = gh
    this.cycle = 0
    this.forceGraphql = true
    this.lastInbox = undefined
    this.lastNotifications = undefined
    this.lastPrs.clear()
    this.snapshot = {
      ...this.snapshot,
      auth: gh || this.hasExtra ? 'ok' : 'missing',
      authSource: source,
      authError: undefined,
      viewer: undefined,
      approvals: undefined,
      notifications: undefined,
      notificationsError: undefined,
      repos: {}
    }
  }

  /** Poll now (or as soon as the in-flight poll finishes). */
  pollSoon(boost = false): void {
    if (boost) this.boostUntil = Date.now() + BOOST_MS
    this.forceGraphql = true
    if (this.running) {
      this.queued = true
      return
    }
    this.schedule(0)
  }

  /** Reflects a mark-as-read straight away instead of waiting for the next poll. */
  markNotificationsRead(id?: string): void {
    if (!this.snapshot.notifications) return
    this.snapshot.notifications = markRead(this.snapshot.notifications, id)
    if (this.lastNotifications?.status === 'fulfilled') this.lastNotifications = { status: 'fulfilled', value: this.snapshot.notifications }
    this.publish()
  }

  stop(): void {
    clearTimeout(this.timer)
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer)
    this.snapshot.nextPoll = Date.now() + ms
    this.timer = setTimeout(() => void this.poll(), ms)
  }

  private publish(): void {
    this.emit('update', this.snapshot)
  }

  private async poll(): Promise<void> {
    const settings = this.getSettings()
    this.running = true
    this.snapshot.polling = true
    this.publish()
    try {
      if (this.gh || this.hasExtra) await this.pollAll(this.gh, settings)
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 401) {
        this.snapshot.auth = 'error'
        this.snapshot.authError = 'GitHub rejected the token. Sign in again in Settings.'
      }
    } finally {
      this.running = false
      this.snapshot.polling = false
      this.snapshot.lastPoll = Date.now()
      this.cycle++
      const active =
        Date.now() < this.boostUntil ||
        Object.values(this.snapshot.repos).some((r) => r.runs.some((run) => run.status !== 'completed'))
      const seconds = (active ? Math.min(settings.activePollSeconds, settings.pollSeconds) : settings.pollSeconds) * pollSlowdown(settings.repos.length)
      this.schedule(this.queued ? 0 : paceForBudget(Math.max(5, seconds) * 1000, this.gh))
      this.queued = false
      this.publish()
    }
  }

  private async pollAll(primary: GitHub | undefined, settings: Settings): Promise<void> {
    const repos = settings.repos
    // Each repo is polled with its own account's client; the inbox and rate limit are the primary account's.
    const clientOf = (repo: string): GitHub => this.resolve?.(repo) ?? primary ?? failNoClient(repo)
    const prev = this.snapshot.repos
    const refreshWorkflows = this.cycle % WORKFLOW_REFRESH_EVERY === 0

    // Separate small GraphQL queries per repo: one combined query gets slow enough for GitHub to 502,
    // and this way one broken repo can't blank out the others.
    const refreshGraphql = this.forceGraphql || Date.now() - this.graphqlAt >= settings.pollSeconds * pollSlowdown(repos.length) * 1000 - 2000
    const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
      p.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason })
      )
    const [inboxResult, notificationResult, runResults, prResults] = await Promise.all([
      refreshGraphql || !this.lastInbox
        ? settle(primary ? this.fetchInbox(primary) : Promise.reject(new Error('no primary account')))
        : Promise.resolve(this.lastInbox),
      // GitHub asks clients not to poll notifications faster than about once a minute, so they share the GraphQL cadence.
      refreshGraphql || !this.lastNotifications
        ? settle(primary ? this.fetchNotifications(primary) : Promise.reject(new Error('no primary account')))
        : Promise.resolve(this.lastNotifications),
      Promise.allSettled(repos.map((repo) => this.fetchRuns(clientOf(repo), repo))),
      Promise.all(repos.map((repo) => (!refreshGraphql && this.lastPrs.get(repo)) || settle(this.fetchPullRequests(clientOf(repo), repo))))
    ])
    if (refreshGraphql) {
      this.graphqlAt = Date.now()
      this.forceGraphql = false
    }
    this.lastInbox = inboxResult
    this.lastNotifications = notificationResult
    if (notificationResult.status === 'fulfilled') {
      this.snapshot.notifications = notificationResult.value
      this.snapshot.notificationsError = undefined
    } else if (primary) {
      const status = (notificationResult.reason as { status?: number }).status
      this.snapshot.notificationsError =
        status === 403 || status === 404
          ? "Your token can't read GitHub notifications. A classic token needs the notifications (or repo) scope."
          : String((notificationResult.reason as Error).message)
    }
    this.lastPrs = new Map(repos.map((repo, i) => [repo, prResults[i]]))
    const workflowResults = await Promise.allSettled(
      repos.map((repo) =>
        refreshWorkflows || !prev[repo]?.workflows.length ? this.fetchWorkflows(clientOf(repo), repo) : Promise.resolve(prev[repo].workflows)
      )
    )

    if (inboxResult.status === 'rejected' && (inboxResult.reason as { status?: number }).status === 401) throw inboxResult.reason
    const inboxData = inboxResult.status === 'fulfilled' ? inboxResult.value : undefined
    if (inboxData) this.snapshot.viewer = inboxData.viewer
    const oldInbox = this.snapshot.inbox
    if (inboxData) this.snapshot.inbox = inboxData.inbox

    const next: Record<string, RepoState> = {}
    const newEvents: AppEvent[] = []
    repos.forEach((repo, i) => {
      const old = prev[repo]
      const runs = runResults[i]
      const wfs = workflowResults[i]
      const prResult = prResults[i]
      const prs = prResult.status === 'fulfilled' ? prResult.value : undefined
      const errors = [
        runs.status === 'rejected' ? String((runs.reason as Error).message) : null,
        prResult.status === 'rejected' ? String((prResult.reason as Error).message) : null
      ].filter((e, j, all) => e && all.indexOf(e) === j)

      const state: RepoState = {
        repo,
        defaultBranch: prs?.defaultBranch ?? old?.defaultBranch,
        runs: runs.status === 'fulfilled' ? runs.value : (old?.runs ?? []),
        prs: prs?.prs ?? old?.prs ?? [],
        workflows: wfs.status === 'fulfilled' ? wfs.value : (old?.workflows ?? []),
        error: errors.length ? errors.join('; ') : undefined,
        fetchedAt: Date.now()
      }
      next[repo] = state
      // Only diff once we have a baseline, so a fresh start doesn't fire a notification storm.
      if (old?.fetchedAt) {
        if (runs.status === 'fulfilled') newEvents.push(...diffRuns(repo, old.runs, state.runs))
        if (prs) newEvents.push(...this.diffPrs(repo, old, state))
      }
    })
    this.snapshot.repos = next

    // Only runs paused for review cost a request here, and an unchanged answer is a free 304.
    const waiting = repos.flatMap((repo) => next[repo].runs.filter((r) => r.status === 'waiting'))
    const approvalResults = await Promise.allSettled(waiting.map((run) => fetchApproval(clientOf(run.repo), run)))
    const oldApprovals = this.snapshot.approvals
    const approvals = approvalResults.flatMap((r, i) => {
      if (r.status === 'fulfilled') return r.value ? [r.value] : []
      // A failed lookup keeps what we knew rather than making the approval vanish and reappear.
      return (oldApprovals ?? []).filter((a) => a.runId === waiting[i].id)
    })
    this.snapshot.approvals = approvals
    if (oldApprovals) {
      for (const a of newApprovalsForYou(oldApprovals, approvals))
        newEvents.push(
          makeEvent(a.repo, 'deploy-approval', `Approval needed: ${a.runName} → ${environmentNames(a)}`, `${a.repo} · ${a.branch} · started by ${a.actor}`, a.runUrl, this.snapshot.viewer?.login)
        )
    }

    this.snapshot.rateLimit = primary?.rate
    this.snapshot.graphqlRateLimit = primary?.graphqlRate
    // Review requests in repos you don't track still deserve a ping.
    if (oldInbox && inboxData) {
      const seen = new Set(oldInbox.reviewRequests.map((i) => i.url))
      for (const item of inboxData.inbox.reviewRequests) {
        if (seen.has(item.url) || repos.includes(item.repo)) continue
        newEvents.push(
          makeEvent(item.repo, 'pr-review', `Review requested: ${item.title}`, `${item.repo}#${item.number} by ${item.author}`, item.url, this.snapshot.viewer?.login)
        )
      }
    }

    const closed = newEvents.filter((e) => e.kind === 'pr-closed')
    await Promise.all(closed.map((e) => this.resolveClosed(clientOf(e.repo), e)))
    const events = newEvents.filter((e) => e.kind !== 'pr-closed' || e.title)
    if (events.length) {
      this.snapshot.events = [...events, ...this.snapshot.events].slice(0, MAX_EVENTS)
      this.emit('events', events)
    }
  }

  private async fetchRuns(gh: GitHub, repo: string): Promise<WorkflowRun[]> {
    const data = await gh.get<{ workflow_runs: GhRun[] }>(`/repos/${repo}/actions/runs?per_page=40`)
    return data.workflow_runs.map((r) => toRun(repo, r))
  }

  private async fetchWorkflows(gh: GitHub, repo: string): Promise<Workflow[]> {
    const data = await gh.get<{ workflows: GhWorkflow[] }>(`/repos/${repo}/actions/workflows?per_page=100`)
    const active = data.workflows.filter((w) => w.state === 'active')
    return Promise.all(
      active.map(async (w) => {
        const base: Workflow = { repo, id: w.id, name: w.name, path: w.path, state: w.state, url: w.html_url, dispatchable: false, inputs: [] }
        // Dynamic workflows (e.g. Dependabot, CodeQL default setup) have no file in the repo.
        if (!w.path.startsWith('.github/workflows/')) return base
        try {
          const file = await gh.get<{ content: string }>(`/repos/${repo}/contents/${encodeURI(w.path)}`)
          return { ...base, ...parseDispatch(Buffer.from(file.content, 'base64').toString('utf8')) }
        } catch {
          return base
        }
      })
    )
  }

  private async fetchInbox(gh: GitHub): Promise<InboxFetch> {
    const data = await gh.graphql<Record<string, unknown>>(INBOX_QUERY, {})
    const search = (key: string) =>
      ((data[key] as { nodes: GqlInboxNode[] } | undefined)?.nodes ?? []).filter((n) => n.number).map(toInboxItem)
    return {
      viewer: data.viewer as InboxFetch['viewer'],
      inbox: { reviewRequests: search('reviewRequests'), myPrs: search('myPrs'), assigned: search('assigned') }
    }
  }

  private async fetchNotifications(gh: GitHub): Promise<GhNotification[]> {
    const threads = await gh.get<GhThread[]>('/notifications?per_page=50')
    return threads.map(toNotification)
  }

  private async fetchPullRequests(gh: GitHub, repo: string): Promise<PrFetch> {
    const [owner, name] = repo.split('/')
    const data = await gh.graphql<{ repository: GqlRepo | null }>(PR_QUERY, { owner, name })
    const r = data.repository
    if (!r) throw new Error('Repository not found or no access')
    return {
      defaultBranch: r.defaultBranchRef?.name,
      prs: r.pullRequests.nodes.map((p) => ({
        repo,
        number: p.number,
        title: p.title,
        url: p.url,
        author: p.author?.login ?? 'ghost',
        authorAvatar: p.author?.avatarUrl ?? '',
        isDraft: p.isDraft,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        branch: p.headRefName,
        additions: p.additions,
        deletions: p.deletions,
        comments: p.comments.totalCount,
        reviewDecision: p.reviewDecision,
        checks: p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
        labels: p.labels.nodes,
        reviewers: p.reviewRequests.nodes
          .map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.slug)
          .filter((x): x is string => Boolean(x))
      }))
    }
  }

  private diffPrs(repo: string, old: RepoState, next: RepoState): AppEvent[] {
    const viewer = this.snapshot.viewer?.login
    const events: AppEvent[] = []
    const oldMap = new Map(old.prs.map((p) => [p.number, p]))
    const nextMap = new Map(next.prs.map((p) => [p.number, p]))
    // Only treat a PR as new if it was created since the last poll; an old PR can enter the
    // top-50-by-updated window just by being touched.
    const since = (old.fetchedAt ?? 0) - 5 * 60_000

    for (const pr of next.prs) {
      const prev = oldMap.get(pr.number)
      const ref = `${repo}#${pr.number}`
      if (!prev) {
        if (Date.parse(pr.createdAt) >= since)
          events.push(makeEvent(repo, 'pr-opened', `PR opened: ${pr.title}`, `${ref} by ${pr.author}`, pr.url, pr.author))
        continue
      }
      if (prev.isDraft && !pr.isDraft)
        events.push(makeEvent(repo, 'pr-ready', `Ready for review: ${pr.title}`, ref, pr.url, pr.author))
      if (viewer && pr.reviewers.includes(viewer) && !prev.reviewers.includes(viewer))
        events.push(makeEvent(repo, 'pr-review', `Review requested: ${pr.title}`, `${ref} by ${pr.author}`, pr.url, viewer))
      if (pr.author === viewer && pr.checks === 'FAILURE' && prev.checks !== 'FAILURE')
        events.push(makeEvent(repo, 'pr-checks-failed', `Checks failed: ${pr.title}`, ref, pr.url, pr.author))
    }
    for (const pr of old.prs) {
      if (!nextMap.has(pr.number)) {
        // Title filled in by resolveClosed once we know whether it was merged.
        const e = makeEvent(repo, 'pr-closed', '', `${repo}#${pr.number} by ${pr.author}`, pr.url, pr.author)
        events.push(Object.assign(e, { meta: pr }))
      }
    }
    return events
  }

  private async resolveClosed(gh: GitHub, e: AppEvent): Promise<void> {
    const pr = (e as AppEvent & { meta: PullRequest }).meta
    delete (e as { meta?: unknown }).meta
    try {
      const data = await gh.get<{ state: string; merged: boolean }>(`/repos/${pr.repo}/pulls/${pr.number}`)
      if (data.state === 'open') return // just fell out of the window
      e.kind = data.merged ? 'pr-merged' : 'pr-closed'
      e.title = `${data.merged ? 'Merged' : 'Closed'}: ${pr.title}`
    } catch {
      // leave title empty so it is dropped
    }
  }
}

function failNoClient(repo: string): never {
  throw new Error(`No account is signed in for ${repo}`)
}

function diffRuns(repo: string, old: WorkflowRun[], next: WorkflowRun[]): AppEvent[] {
  const events: AppEvent[] = []
  const oldMap = new Map(old.map((r) => [r.id, r]))
  const oldest = old.reduce((min, r) => Math.min(min, Date.parse(r.createdAt)), Infinity)
  for (const run of next) {
    const prev = oldMap.get(run.id)
    if (!prev) {
      if (old.length && Date.parse(run.createdAt) < oldest) continue
      events.push(runEvent(run))
    } else if (prev.status !== run.status && (run.status === 'completed' || prev.status === 'completed')) {
      events.push(runEvent(run))
    }
  }
  return events
}

function runEvent(run: WorkflowRun): AppEvent {
  const where = `${run.repo} · ${run.branch} · ${run.title}`
  if (run.status !== 'completed') return makeEvent(run.repo, 'run-started', `▶ ${run.name} started`, where, run.url, run.actor)
  if (run.conclusion === 'success') return makeEvent(run.repo, 'run-success', `✓ ${run.name} succeeded`, where, run.url, run.actor)
  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped')
    return makeEvent(run.repo, 'run-cancelled', `⊘ ${run.name} ${run.conclusion}`, where, run.url, run.actor)
  return makeEvent(run.repo, 'run-failure', `✗ ${run.name} failed`, where, run.url, run.actor)
}

let seq = 0
function makeEvent(repo: string, kind: AppEvent['kind'], title: string, body: string, url: string, actor?: string): AppEvent {
  return { id: `${Date.now()}-${seq++}`, ts: Date.now(), repo, kind, title, body, url, actor, read: false }
}

/** Reads the `workflow_dispatch` trigger and its inputs from a workflow file. */
export function parseDispatch(source: string): Pick<Workflow, 'dispatchable' | 'inputs'> {
  const doc = parseYaml(source) as { on?: unknown; true?: unknown } | null
  // YAML 1.1 parsers turn a bare `on:` key into `true`; handle both.
  const on = doc?.on ?? doc?.true
  if (!on) return { dispatchable: false, inputs: [] }
  if (on === 'workflow_dispatch') return { dispatchable: true, inputs: [] }
  if (Array.isArray(on)) return { dispatchable: on.includes('workflow_dispatch'), inputs: [] }
  if (typeof on !== 'object' || !('workflow_dispatch' in on)) return { dispatchable: false, inputs: [] }
  const wd = (on as Record<string, { inputs?: Record<string, Record<string, unknown>> } | null>).workflow_dispatch
  const inputs: DispatchInput[] = Object.entries(wd?.inputs ?? {}).map(([name, spec]) => ({
    name,
    description: spec?.description as string | undefined,
    required: Boolean(spec?.required),
    default: spec?.default === undefined ? undefined : String(spec.default),
    type: ((spec?.type as string) ?? 'string') as DispatchInput['type'],
    options: Array.isArray(spec?.options) ? (spec.options as unknown[]).map(String) : undefined
  }))
  return { dispatchable: true, inputs }
}

interface InboxFetch {
  viewer: { login: string; avatarUrl: string }
  inbox: Inbox
}

const INBOX_NODES = `nodes {
  ... on PullRequest {
    number title url updatedAt isDraft reviewDecision
    repository { nameWithOwner } author { login avatarUrl }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }
  ... on Issue { number title url updatedAt repository { nameWithOwner } author { login avatarUrl } }
}`

interface GqlInboxNode {
  number: number
  title: string
  url: string
  updatedAt: string
  isDraft?: boolean
  reviewDecision?: PullRequest['reviewDecision']
  repository: { nameWithOwner: string }
  author: { login: string; avatarUrl: string } | null
  commits?: { nodes: { commit: { statusCheckRollup: { state: ChecksState } | null } }[] }
}

function toInboxItem(n: GqlInboxNode): InboxItem {
  return {
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    kind: n.commits ? 'pr' : 'issue',
    author: n.author?.login ?? 'ghost',
    authorAvatar: n.author?.avatarUrl ?? '',
    updatedAt: n.updatedAt,
    isDraft: n.isDraft,
    reviewDecision: n.reviewDecision ?? null,
    checks: n.commits?.nodes[0]?.commit.statusCheckRollup?.state ?? null
  }
}

const INBOX_QUERY = `
query {
  viewer { login avatarUrl }
  reviewRequests: search(type: ISSUE, first: 30, query: "is:open is:pr review-requested:@me archived:false") { ${INBOX_NODES} }
  myPrs: search(type: ISSUE, first: 30, query: "is:open is:pr author:@me archived:false") { ${INBOX_NODES} }
  assigned: search(type: ISSUE, first: 30, query: "is:open is:issue assignee:@me archived:false") { ${INBOX_NODES} }
}`

const PR_QUERY = `
query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  defaultBranchRef { name }
  pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
    nodes {
      number title url isDraft createdAt updatedAt headRefName additions deletions reviewDecision
      author { login avatarUrl }
      comments { totalCount }
      labels(first: 6) { nodes { name color } }
      reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
} }`

interface GqlRepo {
  defaultBranchRef: { name: string } | null
  pullRequests: {
    nodes: {
      number: number
      title: string
      url: string
      isDraft: boolean
      createdAt: string
      updatedAt: string
      headRefName: string
      additions: number
      deletions: number
      reviewDecision: PullRequest['reviewDecision']
      author: { login: string; avatarUrl: string } | null
      comments: { totalCount: number }
      labels: { nodes: { name: string; color: string }[] }
      reviewRequests: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] }
      commits: { nodes: { commit: { statusCheckRollup: { state: ChecksState } | null } }[] }
    }[]
  }
}

export function toRun(repo: string, r: GhRun): WorkflowRun {
  return {
    repo,
    id: r.id,
    workflowId: r.workflow_id,
    name: r.name ?? 'workflow',
    title: r.display_title,
    status: r.status as WorkflowRun['status'],
    conclusion: r.conclusion,
    event: r.event,
    branch: r.head_branch ?? '',
    sha: r.head_sha,
    actor: r.triggering_actor?.login ?? r.actor?.login ?? '',
    actorAvatar: r.triggering_actor?.avatar_url ?? r.actor?.avatar_url ?? '',
    runNumber: r.run_number,
    attempt: r.run_attempt ?? 1,
    createdAt: r.created_at,
    startedAt: r.run_started_at ?? r.created_at,
    updatedAt: r.updated_at,
    url: r.html_url
  }
}

export interface GhRun {
  id: number
  workflow_id: number
  name: string | null
  display_title: string
  status: string
  conclusion: string | null
  event: string
  head_branch: string | null
  head_sha: string
  run_number: number
  run_attempt?: number
  created_at: string
  updated_at: string
  run_started_at?: string
  html_url: string
  actor?: { login: string; avatar_url: string }
  triggering_actor?: { login: string; avatar_url: string }
}

interface GhWorkflow {
  id: number
  name: string
  path: string
  state: string
  html_url: string
}
