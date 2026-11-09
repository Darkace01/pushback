// Types shared between the main process, preload bridge and renderer.

import type { MergeStatus } from './mergeStatus'
import type { ThemeColors } from './themes'

export type RunStatus = 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'

export interface WorkflowRun {
  repo: string
  id: number
  workflowId: number
  name: string
  title: string
  status: RunStatus
  conclusion: string | null
  event: string
  branch: string
  sha: string
  actor: string
  actorAvatar: string
  runNumber: number
  attempt: number
  createdAt: string
  startedAt: string
  updatedAt: string
  url: string
}

export type ChecksState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null

export interface PullRequest {
  repo: string
  number: number
  title: string
  url: string
  author: string
  authorAvatar: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  branch: string
  additions: number
  deletions: number
  comments: number
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  checks: ChecksState
  labels: { name: string; color: string }[]
  reviewers: string[]
}

export interface DispatchInput {
  name: string
  description?: string
  required: boolean
  default?: string
  type: 'string' | 'boolean' | 'choice' | 'number' | 'environment'
  options?: string[]
}

export interface Workflow {
  repo: string
  id: number
  name: string
  path: string
  state: string
  url: string
  dispatchable: boolean
  inputs: DispatchInput[]
}

export interface RepoState {
  repo: string
  defaultBranch?: string
  runs: WorkflowRun[]
  prs: PullRequest[]
  workflows: Workflow[]
  error?: string
  fetchedAt?: number
}

export type EventKind =
  | 'run-started'
  | 'run-success'
  | 'run-failure'
  | 'run-cancelled'
  | 'pr-opened'
  | 'pr-merged'
  | 'pr-closed'
  | 'pr-ready'
  | 'pr-review'
  | 'pr-checks-failed'
  | 'deploy-approval'

export interface AppEvent {
  id: string
  ts: number
  repo: string
  kind: EventKind
  title: string
  body: string
  url: string
  /** Who triggered it (run actor / PR author), used for the "only mine" filter. */
  actor?: string
  read: boolean
}

export type WidgetType = 'summary' | 'runs' | 'prs' | 'workflows' | 'events' | 'inbox' | 'insights' | 'deployments' | 'security' | 'cihealth' | 'search' | 'packages'

export interface WidgetConfig {
  id: string
  type: WidgetType
  title?: string
  /** Repos to show; empty means all tracked repos. */
  repos: string[]
  options: Record<string, string | number | boolean>
}

/** A saved dashboard. The open one's widgets and layout are mirrored in Settings.widgets/layout while it's active. */
export interface SavedDashboard {
  id: string
  name: string
  /** An icon name from the renderer's icon set; unset or unknown falls back to the grid icon. */
  icon?: string
  widgets: WidgetConfig[]
  layout: LayoutItem[]
}

export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export interface NotifySettings {
  runStarted: boolean
  runSuccess: boolean
  runFailure: boolean
  prOpened: boolean
  prClosed: boolean
  prReady: boolean
  reviewRequested: boolean
  checksFailed: boolean
  /** A deployment is waiting for your approval. */
  approvalRequested: boolean
  /** Only notify about runs triggered by / PRs authored by the signed-in user. */
  onlyMine: boolean
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

/** When toasts are held back. Events still land in the activity feed either way. */
export interface NotifyRules {
  /** A daily window (local time, may cross midnight) with no toasts. */
  quietHours: { enabled: boolean; start: string; end: string }
  /** Epoch ms; no toasts until then. 0 when not snoozed. */
  snoozedUntil: number
  /** Repos that never produce toasts. */
  mutedRepos: string[]
}

export interface Settings {
  repos: string[]
  pollSeconds: number
  /** Faster interval used while any run is queued or in progress. */
  activePollSeconds: number
  notify: NotifySettings
  notifyRules: NotifyRules
  /** Which palette is active; 'system' follows the OS light/dark setting. */
  mode: 'dark' | 'light' | 'system'
  darkTheme: string
  lightTheme: string
  /** Per-mode colour overrides layered on top of the chosen preset. */
  colorOverrides: { dark: Partial<ThemeColors>; light: Partial<ThemeColors> }
  /** 'theme' (preset's font), 'system', 'custom' (uses customFont) or a CSS font-family. */
  font: string
  customFont: string
  fontSize: number
  density: 'comfortable' | 'compact'
  closeToTray: boolean
  /** Start Pushback when you sign in to the computer (packaged builds only). */
  launchAtLogin: boolean
  /** When started at login, stay in the tray instead of opening the window. */
  startInTray: boolean
  autoUpdate: boolean
  widgets: WidgetConfig[]
  layout: LayoutItem[]
  dashboards: SavedDashboard[]
  activeDashboard: string
  /** Repos open as tabs, in order. The dashboard tab is always first and isn't listed. */
  openTabs: string[]
  /** Watched repos starred as favourites: listed first, and pinned as tabs when starred. */
  favoriteRepos: string[]
  /** Repos pinned as tabs: always open, shown as icons first. A repo is in pinnedTabs or openTabs, never both. */
  pinnedTabs: string[]
  /** "home" (the dashboard) or one of openTabs / pinnedTabs. */
  activeTab: string
  /** Tabs across the top, or down a sidebar on the left. */
  tabLayout: 'horizontal' | 'vertical'
  /** Whether the left repo sidebar is shown. */
  sidebarOpen: boolean
  /** Settings layout version, for one-off migrations of defaults (1: vertical tabs became the default). */
  uiVersion: number
  /** The first-run walkthrough has been finished or skipped. */
  tourDone: boolean
  /** Local clone folder for each repo that has one linked. */
  localPaths: Record<string, string>
  /** Command used for "Open in editor", given the folder as its argument (e.g. code, cursor, idea). */
  editorCommand: string
  /** Look for new clones in the home folder at startup and link them (watching is still up to the user). */
  autoLinkClones: boolean
  /** Accounts besides the primary github.com login: GitHub Enterprise Server hosts, with their tokens kept in the main process. */
  accounts: Account[]
  /** Which extra account a repo belongs to, by full name. A repo that isn't listed uses the primary account. */
  repoAccounts: Record<string, string>
  /** The account the dashboard follows: 'primary' (the github.com login) or an extra account's id. Its inbox and repos are polled. */
  activeAccount: string
  /** Named GitHub searches the user saved; pinning one makes a `search` widget that carries its own copy of the query. */
  savedSearches: SavedSearch[]
}

/** A cross-repo issue or PR search, e.g. "is:open author:@me" for your open PRs across every org. */
export interface SavedSearch {
  id: string
  name: string
  kind: 'pr' | 'issue'
  /** GitHub search qualifiers; the is:pr / is:issue part is added from `kind`. */
  query: string
}

export interface SearchItem {
  repo: string
  number: number
  title: string
  url: string
  kind: 'pr' | 'issue'
  state: 'open' | 'closed' | 'merged'
  author: string
  authorAvatar: string
  createdAt: string
  updatedAt: string
  comments: number
  isDraft: boolean
  labels: { name: string; color: string }[]
}

export interface SearchResult {
  /** Matches on GitHub; `items` holds the 50 most recently updated. */
  total: number
  incomplete: boolean
  items: SearchItem[]
}

export interface InboxItem {
  repo: string
  number: number
  title: string
  url: string
  kind: 'pr' | 'issue'
  author: string
  authorAvatar: string
  updatedAt: string
  isDraft?: boolean
  checks?: ChecksState
  reviewDecision?: PullRequest['reviewDecision']
}

export interface Inbox {
  reviewRequests: InboxItem[]
  myPrs: InboxItem[]
  assigned: InboxItem[]
}

export interface JobStep {
  name: string
  status: string
  conclusion: string | null
  number: number
  startedAt: string | null
  completedAt: string | null
}

export interface Job {
  id: number
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  url: string
  steps: JobStep[]
}

export interface RateLimit {
  limit: number
  remaining: number
  reset: number
}

export interface Snapshot {
  auth: 'ok' | 'missing' | 'error'
  authSource?: 'pat' | 'gh'
  authError?: string
  viewer?: { login: string; avatarUrl: string }
  repos: Record<string, RepoState>
  inbox?: Inbox
  /** Runs paused for a protected environment's review, in the polled repos. */
  approvals?: PendingApproval[]
  /** GitHub's own notification threads for the primary account, newest first. */
  notifications?: GhNotification[]
  /** Why notifications couldn't be read (usually a token without the notifications scope). */
  notificationsError?: string
  events: AppEvent[]
  rateLimit?: RateLimit
  graphqlRateLimit?: RateLimit
  lastPoll?: number
  nextPoll?: number
  polling: boolean
}

export interface InitialState {
  snapshot: Snapshot
  settings: Settings
}

export interface RepoOption {
  fullName: string
  description: string | null
  private: boolean
  pushedAt: string
}

export interface ActionResult {
  ok: boolean
  error?: string
  /** Set when the action created something (an issue, PR, release…). */
  url?: string
  number?: number
}

export interface DispatchResult extends ActionResult {
  /** The run that was started. GitHub doesn't say which one it is, so it's looked up; absent if it didn't show up in time. */
  run?: WorkflowRun
}

export interface Label {
  name: string
  color: string
  description?: string | null
}

export interface IssueSummary {
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  author: string
  authorAvatar: string
  createdAt: string
  updatedAt: string
  comments: number
  labels: Label[]
  assignees: string[]
}

export interface IssueDetail extends Omit<IssueSummary, 'comments'> {
  bodyHtml: string
  stateReason: string | null
  timeline: PrComment[]
}

export interface BranchInfo {
  name: string
  sha: string
  isDefault: boolean
  date: string
  message: string
  author: string
  authorAvatar?: string
  /** Commits on this branch that the default branch doesn't have, and vice versa. */
  ahead: number
  behind: number
  openPr?: number
}

export interface CommitInfo {
  sha: string
  message: string
  author: string
  authorAvatar?: string
  date: string
  url: string
  parents: string[]
}

export interface ReleaseInfo {
  id: number
  tag: string
  name: string
  url: string
  draft: boolean
  prerelease: boolean
  publishedAt: string | null
  createdAt: string
  author: string
  bodyHtml: string
  assets: { name: string; size: number; downloads: number; url: string }[]
}

/** A pull request merged since the last release, as input to the release-notes draft. */
export interface MergedPr {
  number: number
  title: string
  url: string
  author: string
  labels: string[]
  mergedAt: string
}

export interface ReleaseDraft {
  /** Tag of the last published release the PRs are counted from; null if the repo has none. */
  since: string | null
  prs: MergedPr[]
}

export interface NewPr {
  title: string
  head: string
  base: string
  body: string
  draft: boolean
}

export interface NewRelease {
  tag: string
  target: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  generateNotes: boolean
}

export interface PrComment {
  author: string
  authorAvatar: string
  createdAt: string
  bodyHtml: string
  url: string
  /** Set for reviews: APPROVED, CHANGES_REQUESTED, COMMENTED… */
  reviewState?: string
}

export interface PrFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

export interface PrCommit {
  sha: string
  message: string
  author: string
  authorAvatar?: string
  date: string
}

export interface PrCheck {
  name: string
  status: string
  conclusion: string | null
  url: string
}

/** Everything the in-app PR view shows, fetched on demand when it opens. */
export interface PrDetail {
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  author: string
  authorAvatar: string
  createdAt: string
  base: string
  head: string
  bodyHtml: string
  additions: number
  deletions: number
  changedFiles: number
  mergeableState: string
  labels: { name: string; color: string }[]
  requestedReviewers: string[]
  /** The head commit, which new line comments are made against. */
  headSha: string
  comments: PrComment[]
  commits: PrCommit[]
  files: PrFile[]
  checks: PrCheck[]
}

export interface RepoInfo {
  fullName: string
  description: string | null
  url: string
  homepage: string | null
  private: boolean
  archived: boolean
  defaultBranch: string
  language: string | null
  stars: number
  forks: number
  openIssues: number
  topics: string[]
  pushedAt: string
  readmeHtml: string | null
}

/** One changed file from `git status`: X (index/staged) and Y (worktree) status letters, "?" for untracked. */
export interface GitFile {
  path: string
  index: string
  worktree: string
}

export interface GitStatus {
  path: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
  stashes: number
}

export interface GitCommit {
  sha: string
  subject: string
  author: string
  date: string
  refs: string
}

export interface GitBranch {
  name: string
  upstream: string | null
  /** e.g. "ahead 2, behind 1", or "gone" when the remote branch was deleted. */
  track: string
  current: boolean
  date: string
}

export type GitAction =
  | 'fetch'
  | 'pull'
  | 'push'
  | 'switch'
  | 'create-branch'
  | 'stage'
  | 'unstage'
  | 'stage-all'
  | 'unstage-all'
  | 'discard'
  | 'commit'
  | 'stash'
  | 'stash-pop'
  // History tools (arg is noted after each): commit actions take a SHA.
  | 'cherry-pick' // sha
  | 'revert' // sha
  | 'reset-soft' // sha
  | 'reset-mixed' // sha
  | 'reset-hard' // sha
  | 'branch-at' // [name, sha]
  | 'delete-branch' // name
  | 'force-delete-branch' // name
  | 'merge' // branch
  | 'rebase' // branch
  | 'stash-apply' // index
  | 'stash-drop' // index
  | 'stash-pop-at' // index
  | 'tag' // [name, sha, message?]
  | 'delete-tag' // name
  | 'push-tag' // name
  | 'fetch-remote' // remote name
  | 'worktree-remove' // path, as listed by the worktrees query

/** One GitHub deployment, with its environment split into an Octopus-style stage and client (tenant). */
export interface Deployment {
  id: number
  repo: string
  environment: string
  stage: string
  client: string | null
  ref: string | null
  sha: string
  /** The release tag at the deployed commit, if there is one. */
  version: string | null
  state: 'success' | 'failure' | 'in_progress' | 'queued' | 'waiting' | 'cancelled'
  /** The live deployment for its environment (GitHub's ACTIVE). */
  current: boolean
  createdAt: string
  finishedAt: string | null
  creator: string
  creatorAvatar?: string
  /** The workflow run that deployed it, from the status's log URL. */
  runId: number | null
  logUrl: string | null
  environmentUrl: string | null
  description: string | null
}

export interface RepoDeployments {
  repo: string
  environments: string[]
  /** Newest first, up to 100. */
  deployments: Deployment[]
}

/** A commit with its parents, as drawn in the commit graph (local history or GitHub branches). */
export interface GraphCommit {
  sha: string
  parents: string[]
  subject: string
  author: string
  email?: string
  avatar?: string
  date: string
  /** Refs pointing here as "kind:name": head:main (checked out), branch:x, remote:origin/x, tag:v1. */
  refs: string[]
  url?: string
}

export interface CommitFile {
  path: string
  /** A (added), M, D, R (renamed), C, T. */
  status: string
  oldPath?: string
  additions: number
  deletions: number
}

export interface CommitDetail extends GraphCommit {
  body: string
  committer: string
  committerDate: string
  files: CommitFile[]
}

export interface BlameLine {
  line: number
  sha: string
  author: string
  date: string
  summary: string
  text: string
}

export interface GitTag {
  name: string
  sha: string
  date: string
  subject: string
}

export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface GitWorktree {
  path: string
  branch: string | null
  head: string
  main: boolean
  locked: boolean
}

export interface GitStash {
  index: number
  message: string
  date: string
}

export interface Contributor {
  name: string
  email: string
  commits: number
}

export interface GitRefs {
  current: string | null
  branches: string[]
  remoteBranches: string[]
  tags: string[]
}

/** Read-only questions about a linked clone; `GitAnswer[kind]` is what each returns. */
export type GitQuery =
  | { kind: 'graph'; all: boolean; limit: number }
  | { kind: 'commit'; sha: string }
  | { kind: 'commit-diff'; sha: string; path: string }
  | { kind: 'files' }
  | { kind: 'file-history'; path: string }
  | { kind: 'blame'; path: string }
  | { kind: 'refs' }
  | { kind: 'compare'; base: string; head: string }
  | { kind: 'compare-diff'; base: string; head: string; path: string }
  | { kind: 'search'; mode: 'message' | 'author' | 'sha' | 'file' | 'change'; text: string }
  | { kind: 'stashes' }
  | { kind: 'stash-diff'; index: number }
  | { kind: 'tags' }
  | { kind: 'remotes' }
  | { kind: 'worktrees' }
  | { kind: 'contributors' }

export interface GitAnswer {
  graph: GraphCommit[]
  commit: CommitDetail
  'commit-diff': string
  files: string[]
  'file-history': GraphCommit[]
  blame: BlameLine[]
  refs: GitRefs
  compare: { ahead: GraphCommit[]; behind: GraphCommit[]; files: CommitFile[] }
  'compare-diff': string
  search: GraphCommit[]
  stashes: GitStash[]
  'stash-diff': string
  tags: GitTag[]
  remotes: GitRemote[]
  worktrees: GitWorktree[]
  contributors: Contributor[]
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported'
  current: string
  /** Whether this install can update itself (Windows, AppImage) or only link to the download (macOS, .deb). */
  canInstall: boolean
  version?: string
  percent?: number
  url?: string
  error?: string
}

/** A clone of a GitHub repo found on disk by "Find repos on this computer". */
export interface FoundClone {
  repo: string
  path: string
}

/** An editor or IDE found on this machine; `command` is what Settings.editorCommand is set to. */
export interface EditorOption {
  id: string
  name: string
  command: string
}

export interface PushbackApi {
  getState(): Promise<InitialState>
  onSnapshot(cb: (s: Snapshot) => void): () => void
  onSettings(cb: (s: Settings) => void): () => void
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  setToken(token: string | null): Promise<ActionResult>
  refresh(): Promise<void>
  /** The repos you can access on the primary account, or on an extra one (`accountId`). */
  listMyRepos(accountId?: string): Promise<RepoOption[]>
  dispatch(repo: string, workflowId: number, ref: string, inputs: Record<string, string>): Promise<DispatchResult>
  rerun(repo: string, runId: number, failedOnly: boolean): Promise<ActionResult>
  cancel(repo: string, runId: number): Promise<ActionResult>
  runJobs(repo: string, runId: number): Promise<Job[]>
  jobLog(repo: string, jobId: number): Promise<string>
  approvePr(repo: string, num: number): Promise<ActionResult>
  /** Submits a review. A body is required for COMMENT and REQUEST_CHANGES. */
  reviewPr(repo: string, num: number, event: ReviewEvent, body: string): Promise<ActionResult>
  /** Turns auto-merge on (merges once required checks and reviews pass) or off. GitHub refuses it on repos that don't allow it. */
  autoMergePr(repo: string, num: number, method: 'merge' | 'squash' | 'rebase', enable: boolean): Promise<ActionResult>
  mergePr(repo: string, num: number, method: 'merge' | 'squash' | 'rebase'): Promise<ActionResult>
  exportSettings(): Promise<string>
  importSettings(json: string): Promise<ActionResult>
  openExternal(url: string): Promise<void>
  /** Asks where to save, then writes `content` there (used to export dashboards). `ok: false` with no error if cancelled. */
  saveTextFile(defaultName: string, content: string): Promise<ActionResult>
  /** Asks for a JSON file and returns its text; null if cancelled. */
  openTextFile(): Promise<string | null>
  markRead(ids?: string[]): Promise<void>
  clearEvents(): Promise<void>
  updateStatus(): Promise<UpdateStatus>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  prDetail(repo: string, num: number): Promise<PrDetail>
  commentPr(repo: string, num: number, body: string): Promise<ActionResult>
  repoInfo(repo: string): Promise<RepoInfo>
  listIssues(repo: string, state: 'open' | 'closed'): Promise<IssueSummary[]>
  issueDetail(repo: string, num: number): Promise<IssueDetail>
  createIssue(repo: string, issue: { title: string; body: string; labels: string[] }): Promise<ActionResult>
  setIssueState(repo: string, num: number, state: 'open' | 'closed', reason?: 'completed' | 'not_planned'): Promise<ActionResult>
  listLabels(repo: string): Promise<Label[]>
  /** Runs a cross-repo issue or PR search (the type qualifier is added from `kind`). Rejects on an empty or too long query. */
  runSearch(query: string, kind: 'pr' | 'issue'): Promise<SearchResult>
  listBranches(repo: string, defaultBranch: string): Promise<BranchInfo[]>
  createBranch(repo: string, name: string, from: string): Promise<ActionResult>
  deleteBranch(repo: string, name: string): Promise<ActionResult>
  listCommits(repo: string, ref?: string): Promise<CommitInfo[]>
  listReleases(repo: string): Promise<ReleaseInfo[]>
  createRelease(repo: string, release: NewRelease): Promise<ActionResult>
  createPr(repo: string, pr: NewPr): Promise<ActionResult>
  /** PRs merged into `base` since the repo's latest published release, for drafting release notes. */
  releaseDraft(repo: string, base: string): Promise<ReleaseDraft>
  /** Asks for a folder and links it as the repo's local clone (its remote must point at the repo). */
  gitLink(repo: string): Promise<ActionResult>
  /** Asks for a parent folder and clones the repo into it. */
  gitClone(repo: string): Promise<ActionResult>
  gitUnlink(repo: string): Promise<void>
  /** null when the repo has no local clone linked. */
  gitStatus(repo: string): Promise<GitStatus | null>
  gitLog(repo: string): Promise<GitCommit[]>
  gitBranches(repo: string): Promise<GitBranch[]>
  gitDiff(repo: string, file: string, staged: boolean): Promise<string>
  gitRun(repo: string, action: GitAction, arg?: string | string[]): Promise<ActionResult & { output?: string }>
  gitOpen(repo: string, where: 'editor' | 'terminal' | 'folder'): Promise<ActionResult>
  gitQuery<Q extends GitQuery>(repo: string, query: Q): Promise<GitAnswer[Q['kind']]>
  /** Adds a worktree for an existing branch in a folder picked in a dialog. */
  gitAddWorktree(repo: string, branch: string): Promise<ActionResult>
  /** Environments and the last 100 deployments of a repo. */
  listDeployments(repo: string): Promise<RepoDeployments>
  /** Commit graph across a repo's branches on GitHub (no clone needed): the default branch plus up to 7 more. */
  branchGraph(repo: string, branches: string[]): Promise<GraphCommit[]>
  /**
   * Looks for clones of GitHub repos in the home folder, or in a folder picked in a dialog (`pick`).
   * Undefined if the dialog was cancelled.
   */
  scanClones(pick: boolean): Promise<FoundClone[] | undefined>
  /** Links clones from the last scan (by repo name; the paths come from the scan, not the caller). */
  linkScanned(repos: string[]): Promise<number>
  /** Editors and IDEs installed on this machine, for the default-editor setting. */
  listEditors(): Promise<EditorOption[]>
  // --- accounts ---
  /** The primary login plus every extra account, each with its sign-in state. Never includes a token. */
  listAccounts(): Promise<AccountInfo[]>
  /** Checks the token against the host, then stores it encrypted in the main process. */
  addAccount(account: NewAccount): Promise<ActionResult & { id?: string }>
  removeAccount(id: string): Promise<ActionResult>
  /** Switches the dashboard to another signed-in account ('primary' or an account id). */
  setActiveAccount(id: string): Promise<ActionResult>
  /** Makes a repo use an extra account (null: the primary one). Call before tracking the repo. */
  setRepoAccount(repo: string, accountId: string | null): Promise<ActionResult>
  // --- stale cleanup ---
  /** Open PRs of a repo, least recently updated first (for finding old ones). */
  listOpenPrs(repo: string): Promise<StalePr[]>
  /** Deletes branches and closes PRs in bulk. The main process re-checks each one and reports per item. */
  cleanup(repo: string, req: CleanupRequest): Promise<CleanupResult>
  // --- merge status ---
  /** What blocks a PR from merging (required checks, reviews, conflicts) and its merge-queue position. */
  prMergeStatus(repo: string, num: number): Promise<MergeStatus>
  // --- security alerts ---
  /** Open Dependabot, code-scanning and secret-scanning alerts of a repo (a kind the token can't read is listed in `unavailable`). */
  listSecurity(repo: string): Promise<RepoSecurity>
  // --- packages ---
  /** GitHub Packages published by you ('@me') or by an organisation (its login). If the token can't read any type, `unavailable` says why. */
  listPackages(owner: string): Promise<OwnerPackages>
  /** Logins of the organisations you belong to. */
  listPackageOrgs(): Promise<string[]>
  /** Recent versions of one package, newest first. */
  packageVersions(owner: string, type: PackageType, name: string): Promise<PackageVersion[]>
  // --- deployment approvals ---
  /** The environments a waiting run needs approved; null when it isn't waiting on any. */
  pendingDeployments(repo: string, runId: number): Promise<PendingApproval | null>
  /** Approves or rejects a waiting run's deployments to the given environments. GitHub requires a comment. */
  reviewDeployments(repo: string, runId: number, environmentIds: number[], state: 'approved' | 'rejected', comment: string): Promise<ActionResult>
  // --- run artifacts ---
  runArtifacts(repo: string, runId: number): Promise<RunArtifact[]>
  /** Asks where to save, then downloads the artifact's zip there. `ok: false` with no error if cancelled. */
  downloadArtifact(repo: string, artifactId: number, name: string): Promise<ActionResult>
  // --- inline review ---
  prThreads(repo: string, num: number): Promise<ReviewThread[]>
  /** Starts a review thread on one line of the diff. */
  commentLine(repo: string, num: number, comment: NewLineComment): Promise<ActionResult>
  replyToThread(repo: string, num: number, commentId: number, body: string): Promise<ActionResult>
  resolveThread(repo: string, threadId: string, resolved: boolean): Promise<ActionResult>
  // --- GitHub notifications ---
  /** Marks one notification thread read on GitHub, or every one when no id is given. */
  readNotifications(threadId?: string): Promise<ActionResult>
  // --- Actions settings ---
  /** One list from a repo's Actions settings (secret names, variables, self-hosted runners or caches). Never polled. */
  actionsAdmin<K extends ActionsAdminKind>(repo: string, kind: K): Promise<ActionsAdminAnswer[K]>
  /** Creates, updates or deletes a secret or variable, or deletes caches. */
  actionsAdminAct(repo: string, action: ActionsAdminAction): Promise<ActionResult>
  /** Fired when a notification is clicked: open this GitHub URL inside the app. */
  onNavigate(cb: (url: string) => void): () => void
}

// --- security alerts ---

export type AlertKind = 'dependabot' | 'code-scanning' | 'secret-scanning'
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface SecurityAlert {
  repo: string
  kind: AlertKind
  number: number
  severity: AlertSeverity
  title: string
  /** The package (Dependabot), file (code scanning) or secret type (secret scanning). */
  detail: string
  url: string
  createdAt: string
}

export interface RepoSecurity {
  repo: string
  alerts: SecurityAlert[]
  /** Kinds GitHub wouldn't list (feature off, or the token lacks access), with the reason. */
  unavailable: Partial<Record<AlertKind, string>>
}

// --- packages ---

export type PackageType = 'npm' | 'maven' | 'rubygems' | 'nuget' | 'container'

export interface PackageInfo {
  /** '@me' for your own packages, else the organisation's login. */
  owner: string
  name: string
  type: PackageType
  visibility: 'public' | 'private' | 'internal'
  versionCount: number
  /** The repository it was published from, when GitHub knows it. */
  repo?: string
  url: string
  createdAt: string
  updatedAt: string
}

export interface OwnerPackages {
  owner: string
  packages: PackageInfo[]
  unavailable?: string
}

export interface PackageVersion {
  id: number
  /** The version number (npm, Maven, RubyGems, NuGet) or the digest (container images). */
  name: string
  /** Container image tags; empty for the other types. */
  tags: string[]
  url: string
  createdAt: string
}

// --- stale cleanup ---

export interface StalePr {
  number: number
  title: string
  url: string
  author: string
  createdAt: string
  updatedAt: string
  draft: boolean
}

export interface CleanupRequest {
  /** Branch names to delete. */
  branches: string[]
  /** Pull request numbers to close. */
  closePrs: number[]
}

export interface CleanupResult {
  ok: boolean
  /** What was deleted or closed, as "branch x" / "PR #n". */
  done: string[]
  failed: { item: string; error: string }[]
}

// --- accounts ---

/** An extra account. The token is stored by the main process under `id` and is never part of this. */
export interface Account {
  id: string
  name: string
  /** Web host, e.g. ghe.example.com. */
  host: string
  /** REST API root, e.g. https://ghe.example.com/api/v3. */
  apiUrl: string
}

export interface AccountInfo extends Account {
  /** The github.com login (PAT or gh CLI); it can't be removed here. */
  primary: boolean
  /** The account the dashboard currently follows. */
  active?: boolean
  login?: string
  status: 'ok' | 'error' | 'missing'
  error?: string
}

export interface NewAccount {
  name: string
  host: string
  token: string
}

// --- deployment approvals ---

export interface PendingEnvironment {
  id: number
  name: string
  url: string
  /** Minutes a wait timer holds the deployment after approval; 0 for none. */
  waitTimer: number
  /** Whether the signed-in user is one of the required reviewers. */
  canApprove: boolean
  /** Required reviewers: user logins and team slugs. */
  reviewers: string[]
}

/** A workflow run paused until someone approves its deployments. */
export interface PendingApproval {
  repo: string
  runId: number
  runName: string
  runNumber: number
  runUrl: string
  branch: string
  actor: string
  /** When the run started waiting (the run's last update). */
  since: string
  environments: PendingEnvironment[]
}

// --- run artifacts ---

export interface RunArtifact {
  id: number
  name: string
  /** Bytes. */
  size: number
  expired: boolean
  createdAt: string
  expiresAt: string | null
}

// --- inline review ---

export interface ReviewComment {
  /** REST id, used to reply. */
  id: number
  author: string
  authorAvatar: string
  /** GitHub-rendered HTML; render it through <Markdown>. */
  bodyHtml: string
  createdAt: string
  url: string
}

export interface ReviewThread {
  /** GraphQL node id, used to resolve the thread. */
  id: string
  path: string
  /** The line in the current diff; null once the code it was on has changed (outdated). */
  line: number | null
  side: 'LEFT' | 'RIGHT'
  resolved: boolean
  outdated: boolean
  comments: ReviewComment[]
}

export interface NewLineComment {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
  commitId: string
}

// --- GitHub notifications ---

export interface GhNotification {
  /** The thread id GitHub marks read. */
  id: string
  repo: string
  title: string
  /** PullRequest, Issue, Release, Discussion, CheckSuite, Commit… */
  type: string
  /** Why you got it: review_requested, mention, author, ci_activity… */
  reason: string
  unread: boolean
  updatedAt: string
  /** The page on GitHub it is about. */
  url: string
}

// --- Actions settings (secrets, variables, runners, caches) ---

export interface ActionsSecret {
  name: string
  createdAt: string
  updatedAt: string
}

export interface ActionsVariable {
  name: string
  value: string
  createdAt: string
  updatedAt: string
}

export interface ActionsRunner {
  id: number
  name: string
  os: string
  status: 'online' | 'offline'
  busy: boolean
  labels: string[]
}

export interface ActionsCache {
  id: number
  key: string
  ref: string
  /** Bytes. */
  size: number
  lastUsedAt: string
  createdAt: string
}

/** A list from the repo's Actions settings. `unavailable` says why GitHub refused it (the token lacks access), instead of an error. */
export interface ActionsList<T> {
  items: T[]
  /** How many GitHub has in all; more than `items` when the list was cut short. */
  total: number
  unavailable?: string
}

export interface ActionsCaches extends ActionsList<ActionsCache> {
  /** Every active cache in the repo, in bytes, and how many there are. */
  usageBytes: number
  usageCount: number
}

export interface ActionsAdminAnswer {
  secrets: ActionsList<ActionsSecret>
  variables: ActionsList<ActionsVariable>
  runners: ActionsList<ActionsRunner>
  caches: ActionsCaches
}

export type ActionsAdminKind = keyof ActionsAdminAnswer

/** A change to a repo's Actions settings. Secret values only ever travel renderer → main, encrypted there before they leave. */
export type ActionsAdminAction =
  | { kind: 'set-secret'; name: string; value: string }
  | { kind: 'delete-secret'; name: string }
  | { kind: 'set-variable'; name: string; value: string; /** Updates this existing variable (renaming it if `name` differs) instead of creating one. */ existing?: string }
  | { kind: 'delete-variable'; name: string }
  | { kind: 'delete-cache'; id: number }
  | { kind: 'delete-caches-for-ref'; ref: string }
