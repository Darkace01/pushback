import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell, Tray } from 'electron'
import { cpSync, existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AccountInfo, ActionResult, AppEvent, CleanupRequest, DispatchResult, NewAccount, EventKind, GitAction, GitQuery, Job, NewPr, NewRelease, NotifySettings, RepoOption, ReviewEvent, Settings } from '../shared/types'
import { fetchPrDetail, fetchRepoInfo } from './details'
import { GitHub } from './github'
import * as tools from './repoTools'
import { isSilenced, normalizeNotifyRules, withoutMuted } from '../shared/notifyRules'
import * as git from './git'
import * as gitTools from './gitTools'
import { listEditors } from './editors'
import { findClones } from './scan'
import { listDeployments } from './deployments'
import { listSecurity } from './security'
import { listPackageOrgs, listPackages, packageVersions } from './packages'
import { fetchMergeStatus } from './mergeStatus'
import { fetchMergeQueue } from './mergeQueue'
import { fetchWorkflowFile } from './workflowFile'
import { AccountClients, hasAccountToken, saveAccountToken } from './accounts'
import { accountOf, apiUrlFor, hostOf, normalizeHost, reposOfAccount, GITHUB_HOST } from '../shared/accounts'
import { applyCleanup, listOpenPrs } from './cleanup'
import { runSearch } from './search'
import { resolveEditor } from '../shared/defaults'
import { attentionCount, badgeText } from '../shared/attention'
import { Poller, toRun, type GhRun } from './poller'
import { exportSettingsJson, importSettingsJson } from './importer'
import { findTheme } from '../shared/themes'
import { loadEvents, loadSettings, resolveToken, saveEvents, savePat, saveSettings } from './store'
import { appIcon } from './icon'
import { checkForUpdates, initUpdater, installUpdate, RELEASES_URL, updateStatus } from './updater'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let settings: Settings

// The poller follows the active account, so it sees only that account's repos.
const poller = new Poller(() => ({ ...settings, repos: reposOfAccount(settings.repos, settings.repoAccounts, settings.activeAccount) }), [])
/** The signed-in github.com login (PAT or gh CLI). The poller's own client is whichever account is active. */
let primaryClient: GitHub | undefined

const REVIEW_EVENTS: ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']

const NOTIFY_KEY: Record<EventKind, keyof NotifySettings> = {
  'run-started': 'runStarted',
  'run-success': 'runSuccess',
  'run-failure': 'runFailure',
  'run-cancelled': 'runFailure',
  'pr-opened': 'prOpened',
  'pr-merged': 'prClosed',
  'pr-closed': 'prClosed',
  'pr-ready': 'prReady',
  'pr-review': 'reviewRequested',
  'pr-checks-failed': 'checksFailed'
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function notify(events: AppEvent[]): void {
  if (!Notification.isSupported()) return
  // Snooze and quiet hours hold back toasts only: the events are already in the feed and the unread badge.
  if (isSilenced(settings.notifyRules, new Date())) return
  const viewer = poller.snapshot.viewer?.login
  const wanted = withoutMuted(events, settings.notifyRules).filter((e) => {
    if (!settings.notify[NOTIFY_KEY[e.kind]]) return false
    // Review requests are always about you, so "only mine" never hides them.
    return !settings.notify.onlyMine || e.kind === 'pr-review' || !viewer || e.actor === viewer
  })
  // Collapse bursts (e.g. a matrix finishing) into one toast.
  if (wanted.length > 3) {
    const n = new Notification({ title: `Pushback · ${wanted.length} updates`, body: wanted.slice(0, 4).map((e) => e.title).join('\n') })
    n.on('click', showWindow)
    n.show()
    return
  }
  // Clicking a toast opens the run or PR inside Pushback, not the browser.
  for (const e of wanted) {
    const n = new Notification({ title: e.title, body: e.body, silent: e.kind === 'run-started' })
    n.on('click', () => {
      showWindow()
      send('navigate', e.url)
    })
    n.show()
  }
}

function updateTray(): void {
  if (!tray) return
  const attention = attentionCount(poller.snapshot)
  const running = Object.values(poller.snapshot.repos).reduce((n, r) => n + r.runs.filter((x) => x.status !== 'completed').length, 0)
  tray.setToolTip(`Pushback — ${running} running, ${attention} need attention`)
  if (process.platform === 'darwin') tray.setTitle(badgeText(attention))
  if (process.platform !== 'win32') app.setBadgeCount(attention)
  tray.setContextMenu(trayMenu(attention))
}

/** Start with the OS login. Only for packaged builds: a dev or test run must not register electron.exe. */
function applyLoginItem(): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: settings.startInTray ? ['--hidden'] : [] })
}

poller.on('update', (snapshot) => {
  send('snapshot', snapshot)
  updateTray()
})
poller.on('events', (events) => {
  saveEvents(poller.snapshot.events)
  notify(events)
})

/** Forget account mappings for repos that are neither tracked nor open as a tab. */
function pruneRepoAccounts(): void {
  const used = new Set([...settings.repos, ...settings.openTabs, ...settings.pinnedTabs])
  const kept = Object.entries(settings.repoAccounts).filter(([repo]) => used.has(repo))
  if (kept.length !== Object.keys(settings.repoAccounts).length) settings = { ...settings, repoAccounts: Object.fromEntries(kept) }
}

function failSignedOut(account: { name: string; host: string }): never {
  throw new Error(`Not signed in to ${account.name} (${account.host})`)
}

async function connect(): Promise<void> {
  wireAccounts()
  const auth = await resolveToken()
  primaryClient = auth ? new GitHub(auth.token) : undefined
  const active = settings.accounts.find((a) => a.id === settings.activeAccount)
  poller.setClient(active ? accountClients.get(active) : primaryClient, active ? undefined : auth?.source)
  poller.pollSoon()
}

function showWindow(): void {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

const IS_MAC = process.platform === 'darwin'
// The app's top bar doubles as the title bar, so the OS window controls sit inside it. Matches .topbar in styles.css.
const TITLE_BAR_HEIGHT = 44

/** The theme colours the main process paints itself: the background before the page loads (no white flash) and the window controls. */
function windowColors(): { bg: string; panel: string; text: string } {
  const light = settings.mode === 'light' || (settings.mode === 'system' && !nativeTheme.shouldUseDarkColors)
  const mode = light ? 'light' : 'dark'
  const c = { ...findTheme(light ? settings.lightTheme : settings.darkTheme, mode).colors, ...settings.colorOverrides[mode] }
  return { bg: c.bg, panel: c.panel, text: c.text }
}

function titleBarOverlay(): Electron.TitleBarOverlayOptions {
  const c = windowColors()
  return { color: c.panel, symbolColor: c.text, height: TITLE_BAR_HEIGHT }
}

/** Repaint after a theme change so the minimise/maximise/close buttons match the top bar. */
function paintWindow(): void {
  if (!win || win.isDestroyed()) return
  win.setBackgroundColor(windowColors().bg)
  if (!IS_MAC) win.setTitleBarOverlay(titleBarOverlay())
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: windowColors().bg,
    // No native title bar: the top bar is draggable and the OS draws its controls over its right end (left on macOS).
    titleBarStyle: 'hidden',
    ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 14 } } : { titleBarOverlay: titleBarOverlay() }),
    autoHideMenuBar: true,
    title: 'Pushback',
    icon: appIcon(64),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  // Started by the login item with --hidden: sit in the tray until the user opens the window.
  const hidden = process.argv.includes('--hidden') && settings.startInTray
  win.once('ready-to-show', () => !hidden && win?.show())
  win.on('close', (e) => {
    if (settings.closeToTray && !quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => (win = null))
  // Never navigate the app window; open links in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function trayMenu(attention: number): Menu {
  return Menu.buildFromTemplate([
      { label: attention ? `Open Pushback (${attention} need attention)` : 'Open Pushback', click: showWindow },
      { label: 'Refresh now', click: () => poller.pollSoon() },
      {
        label: 'Check for updates',
        click: () =>
          void checkForUpdates().then((s) => {
            if (s.state === 'available' && !s.canInstall) void shell.openExternal(s.url ?? RELEASES_URL)
          })
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
  ])
}

function createTray(): void {
  tray = new Tray(appIcon(16))
  tray.on('click', showWindow)
  updateTray()
}

async function run(action: () => Promise<unknown>, boost = true): Promise<ActionResult> {
  try {
    await action()
    poller.pollSoon(boost)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Like run(), for actions that create something: passes the new item's url/number back to the UI. */
async function create(action: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const result = await action()
    poller.pollSoon()
    return result
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function setLocalPath(repo: string, path: string | null): void {
  setLocalPaths({ [repo]: path })
}

function setLocalPaths(changes: Record<string, string | null>): void {
  const localPaths = { ...settings.localPaths }
  for (const [repo, path] of Object.entries(changes)) {
    if (path) localPaths[repo] = path
    else delete localPaths[repo]
  }
  settings = { ...settings, localPaths }
  saveSettings(settings)
  send('settings', settings)
}

// The clones found by the last scan, by lower-case repo name. Linking reads paths from here, so the
// renderer can only ever link folders the scanner itself found.
let scanned = new Map<string, string>()

/** A found repo under the name the app already uses for it (GitHub names are case-insensitive). */
function knownName(repo: string): string {
  const all = [...settings.repos, ...Object.keys(settings.localPaths), ...settings.openTabs]
  return all.find((r) => r.toLowerCase() === repo.toLowerCase()) ?? repo
}

async function scan(root?: string) {
  const clones = (await findClones(root)).map((c) => ({ ...c, repo: knownName(c.repo) }))
  scanned = new Map()
  for (const c of clones) if (!scanned.has(c.repo.toLowerCase())) scanned.set(c.repo.toLowerCase(), c.path)
  return clones
}

/** At startup, link clones of repos that have no folder linked yet (opt-in: Settings.autoLinkClones). */
async function autoLinkClones(): Promise<void> {
  if (!settings.autoLinkClones) return
  await scan()
  const linked = new Set(Object.keys(settings.localPaths).map((r) => r.toLowerCase()))
  const changes = Object.fromEntries([...scanned].filter(([r]) => !linked.has(r)).map(([r, path]) => [knownName(r), path]))
  if (Object.keys(changes).length) setLocalPaths(changes)
}

/** The linked clone for a repo. Only folders the user picked in a dialog ever end up here. */
function localPath(repo: string): string {
  const path = settings.localPaths[repo]
  if (!path) throw new Error(`No local clone linked for ${repo}`)
  return path
}

/** The primary github.com login's client: repos that aren't routed to an extra account use it. */
function requireClient(): GitHub {
  if (!primaryClient) throw new Error('Not signed in to GitHub')
  return primaryClient
}

/** The active account's client: what search, packages and the repo picker use. */
function activeClient(): GitHub {
  const account = settings.accounts.find((a) => a.id === settings.activeAccount)
  if (!account) return requireClient()
  return accountClients.get(account) ?? failSignedOut(account)
}

const accountClients = new AccountClients()

/** The client for a repo: its extra account's (GitHub Enterprise Server), or the primary login's. */
function clientFor(repo: string): GitHub {
  const account = accountOf(repo, settings.repoAccounts, settings.accounts)
  if (!account) return requireClient()
  const client = accountClients.get(account)
  if (!client) throw new Error(`Not signed in to ${account.name} (${account.host})`)
  return client
}

const hostFor = (repo: string): string => hostOf(repo, settings.repoAccounts, settings.accounts)

/** Points the poller at each repo's own account. Called whenever accounts or tokens change. */
function wireAccounts(): void {
  poller.setResolver(
    (repo) => {
      const account = accountOf(repo, settings.repoAccounts, settings.accounts)
      return account ? accountClients.get(account) : undefined
    },
    settings.accounts.some((a) => hasAccountToken(a.id))
  )
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => ({ snapshot: poller.snapshot, settings }))
  ipcMain.handle('settings:save', (_e, { localPaths: _ignored, accounts: _accounts, repoAccounts: _repoAccounts, ...patch }: Partial<Settings>) => {
    // localPaths decide where git commands run, so only the link/clone dialogs may set them.
    const reposChanged = patch.repos && patch.repos.join() !== settings.repos.join()
    const intervalChanged = patch.pollSeconds !== undefined || patch.activePollSeconds !== undefined
    settings = {
      ...settings,
      ...patch,
      notify: { ...settings.notify, ...patch.notify },
      notifyRules: patch.notifyRules ? normalizeNotifyRules(patch.notifyRules) : settings.notifyRules
    }
    pruneRepoAccounts()
    saveSettings(settings)
    if (patch.mode || patch.darkTheme || patch.lightTheme || patch.colorOverrides) paintWindow()
    if (reposChanged || intervalChanged) poller.pollSoon()
    if (patch.launchAtLogin !== undefined || patch.startInTray !== undefined) applyLoginItem()
    return settings
  })
  ipcMain.handle('auth:set', async (_e, token: string | null): Promise<ActionResult> => {
    try {
      if (token) {
        const gh = new GitHub(token.trim())
        await gh.get('/user') // validate before saving
      }
      savePat(token?.trim() || null)
      await connect()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('poll:now', () => poller.pollSoon())
  ipcMain.handle('repos:mine', async (_e, accountId?: string): Promise<RepoOption[]> => {
    const account = settings.accounts.find((a) => a.id === (accountId ?? settings.activeAccount))
    const gh = account ? (accountClients.get(account) ?? failSignedOut(account)) : requireClient()
    type GhRepo = { full_name: string; description: string | null; private: boolean; pushed_at: string }
    // Up to 500 repos, most recently pushed first; a short page means we've reached the end.
    const repos: GhRepo[] = []
    for (let page = 1; page <= 5; page++) {
      const batch = await gh.get<GhRepo[]>(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`)
      repos.push(...batch)
      if (batch.length < 100) break
    }
    return repos.map((r) => ({ fullName: r.full_name, description: r.description, private: r.private, pushedAt: r.pushed_at }))
  })
  ipcMain.handle('wf:dispatch', async (_e, repo: string, id: number, ref: string, inputs: Record<string, string>): Promise<DispatchResult> => {
    try {
      const gh = clientFor(repo)
      const recent = () =>
        gh
          .get<{ workflow_runs: GhRun[] }>(`/repos/${repo}/actions/workflows/${id}/runs?event=workflow_dispatch&per_page=10`)
          .then((d) => d.workflow_runs)
          .catch(() => [] as GhRun[])
      const known = new Set((await recent()).map((r) => r.id))
      await gh.send('POST', `/repos/${repo}/actions/workflows/${id}/dispatches`, { ref, inputs })
      poller.pollSoon()
      // GitHub answers 204 without naming the run it queued, so look for the one that wasn't there before. It
      // usually appears within a couple of seconds; if not, the caller falls back to "Started".
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const fresh = (await recent()).find((r) => !known.has(r.id))
        if (fresh) return { ok: true, run: toRun(repo, fresh) }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('run:rerun', (_e, repo: string, id: number, failedOnly: boolean) =>
    run(() => clientFor(repo).send('POST', `/repos/${repo}/actions/runs/${id}/${failedOnly ? 'rerun-failed-jobs' : 'rerun'}`))
  )
  ipcMain.handle('run:cancel', (_e, repo: string, id: number) =>
    run(() => clientFor(repo).send('POST', `/repos/${repo}/actions/runs/${id}/cancel`))
  )
  ipcMain.handle('run:jobs', async (_e, repo: string, id: number): Promise<Job[]> => {
    const data = await clientFor(repo).get<{ jobs: GhJob[] }>(`/repos/${repo}/actions/runs/${id}/jobs?per_page=100`)
    return data.jobs.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
      startedAt: j.started_at,
      completedAt: j.completed_at,
      url: j.html_url,
      steps: (j.steps ?? []).map((s) => ({
        name: s.name,
        status: s.status,
        conclusion: s.conclusion,
        number: s.number,
        startedAt: s.started_at ?? null,
        completedAt: s.completed_at ?? null
      }))
    }))
  })
  ipcMain.handle('job:log', async (_e, repo: string, jobId: number): Promise<string> => {
    const log = await clientFor(repo).text(`/repos/${repo}/actions/jobs/${jobId}/logs`)
    // Keep the tail: that's where failures are, and full logs can be many MB.
    return log.split(/\r?\n/).slice(-400).join('\n')
  })
  ipcMain.handle('pr:approve', (_e, repo: string, num: number) =>
    run(() => clientFor(repo).send('POST', `/repos/${repo}/pulls/${num}/reviews`, { event: 'APPROVE' }), false)
  )
  ipcMain.handle('pr:merge', (_e, repo: string, num: number, method: 'merge' | 'squash' | 'rebase') =>
    run(() => clientFor(repo).send('PUT', `/repos/${repo}/pulls/${num}/merge`, { merge_method: method }), false)
  )
  ipcMain.handle('pr:review', (_e, repo: string, num: number, event: ReviewEvent, body: string) =>
    run(() => {
      if (!REVIEW_EVENTS.includes(event)) throw new Error('Unknown review type')
      const text = typeof body === 'string' ? body.trim() : ''
      // GitHub rejects these two without a message; say so here instead of with a bare 422.
      if (event !== 'APPROVE' && !text) throw new Error(event === 'COMMENT' ? 'Write a comment first' : 'Say what needs to change')
      return clientFor(repo).send('POST', `/repos/${repo}/pulls/${num}/reviews`, { event, ...(text && { body: text }) })
    }, false)
  )
  ipcMain.handle('pr:auto-merge', (_e, repo: string, num: number, method: 'merge' | 'squash' | 'rebase', enable: boolean) =>
    run(async () => {
      const gh = clientFor(repo)
      // Auto-merge exists only in GraphQL, which wants the pull request's node id.
      const { node_id } = await gh.get<{ node_id: string }>(`/repos/${repo}/pulls/${num}`)
      if (!enable) {
        await gh.graphql(`mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }`, { id: node_id })
        return
      }
      const mergeMethod = { merge: 'MERGE', squash: 'SQUASH', rebase: 'REBASE' }[method]
      if (!mergeMethod) throw new Error('Unknown merge method')
      await gh.graphql(
        `mutation($id: ID!, $method: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId } }`,
        { id: node_id, method: mergeMethod }
      )
    }, false)
  )
  ipcMain.handle('settings:export', () => exportSettingsJson(settings))
  ipcMain.handle('settings:import', (_e, json: string): ActionResult => {
    try {
      settings = importSettingsJson(settings, json)
      saveSettings(settings)
      send('settings', settings)
      paintWindow()
      poller.pollSoon()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('file:save-text', async (_e, defaultName: string, content: string): Promise<ActionResult> => {
    // The user picks the destination in a dialog; the renderer never names a path.
    const pick = await dialog.showSaveDialog(win!, { defaultPath: basename(defaultName), filters: [{ name: 'Pushback JSON', extensions: ['json'] }] })
    if (pick.canceled || !pick.filePath) return { ok: false }
    try {
      await writeFile(pick.filePath, content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('file:open-text', async (): Promise<string | null> => {
    const pick = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Pushback JSON', extensions: ['json'] }] })
    if (pick.canceled || !pick.filePaths[0]) return null
    return readFile(pick.filePaths[0], 'utf8')
  })
  ipcMain.handle('open', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('events:read', (_e, ids?: string[]) => {
    const set = ids ? new Set(ids) : null
    poller.snapshot.events = poller.snapshot.events.map((e) => (!set || set.has(e.id) ? { ...e, read: true } : e))
    saveEvents(poller.snapshot.events)
    send('snapshot', poller.snapshot)
    updateTray()
  })
  ipcMain.handle('events:clear', () => {
    poller.snapshot.events = []
    saveEvents([])
    send('snapshot', poller.snapshot)
    updateTray()
  })
  ipcMain.handle('pr:detail', (_e, repo: string, num: number) => fetchPrDetail(clientFor(repo), repo, num))
  ipcMain.handle('pr:comment', (_e, repo: string, num: number, body: string) =>
    run(() => clientFor(repo).send('POST', `/repos/${repo}/issues/${num}/comments`, { body }), false)
  )
  ipcMain.handle('repo:info', (_e, repo: string) => fetchRepoInfo(clientFor(repo), repo))
  ipcMain.handle('issues:list', (_e, repo: string, state: 'open' | 'closed') => tools.listIssues(clientFor(repo), repo, state))
  ipcMain.handle('issue:detail', (_e, repo: string, num: number) => tools.issueDetail(clientFor(repo), repo, num))
  ipcMain.handle('issue:create', (_e, repo: string, issue: { title: string; body: string; labels: string[] }) =>
    create(() => tools.createIssue(clientFor(repo), repo, issue))
  )
  ipcMain.handle('issue:state', (_e, repo: string, num: number, state: 'open' | 'closed', reason?: string) =>
    run(() => clientFor(repo).send('PATCH', `/repos/${repo}/issues/${num}`, { state, ...(reason && { state_reason: reason }) }), false)
  )
  ipcMain.handle('search:run', (_e, query: string, kind: 'pr' | 'issue') => runSearch(activeClient(), String(query), kind === 'issue' ? 'issue' : 'pr'))
  ipcMain.handle('labels:list', (_e, repo: string) => tools.listLabels(clientFor(repo), repo))
  ipcMain.handle('branches:list', (_e, repo: string, defaultBranch: string) => tools.listBranches(clientFor(repo), repo, defaultBranch))
  ipcMain.handle('branch:create', (_e, repo: string, name: string, from: string) => create(() => tools.createBranch(clientFor(repo), repo, name, from)))
  ipcMain.handle('branch:delete', (_e, repo: string, name: string) =>
    run(() => clientFor(repo).send('DELETE', `/repos/${repo}/git/refs/heads/${tools.refPath(name)}`), false)
  )
  ipcMain.handle('commits:list', (_e, repo: string, ref?: string) => tools.listCommits(clientFor(repo), repo, ref))
  ipcMain.handle('releases:list', (_e, repo: string) => tools.listReleases(clientFor(repo), repo))
  ipcMain.handle('release:create', (_e, repo: string, release: NewRelease) => create(() => tools.createRelease(clientFor(repo), repo, release)))
  ipcMain.handle('release:draft', (_e, repo: string, base: string) => tools.releaseDraft(clientFor(repo), repo, base))
  ipcMain.handle('pr:create', (_e, repo: string, pr: NewPr) => create(() => tools.createPr(clientFor(repo), repo, pr)))
  ipcMain.handle('git:link', async (_e, repo: string): Promise<ActionResult> => {
    const pick = await dialog.showOpenDialog(win!, { title: `Choose your local clone of ${repo}`, properties: ['openDirectory'] })
    if (pick.canceled || !pick.filePaths[0]) return { ok: false }
    try {
      const root = await git.topLevel(pick.filePaths[0])
      if (!(await git.remoteMatches(root, repo, hostFor(repo)))) return { ok: false, error: `None of the remotes in ${root} point at ${hostFor(repo)}/${repo}` }
      setLocalPath(repo, root)
      return { ok: true }
    } catch {
      return { ok: false, error: `${pick.filePaths[0]} isn't a git repository` }
    }
  })
  ipcMain.handle('git:clone', async (_e, repo: string): Promise<ActionResult> => {
    const pick = await dialog.showOpenDialog(win!, { title: `Clone ${repo} into…`, properties: ['openDirectory', 'createDirectory'] })
    if (pick.canceled || !pick.filePaths[0]) return { ok: false }
    try {
      setLocalPath(repo, await git.clone(repo, pick.filePaths[0], hostFor(repo)))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('git:scan', async (_e, pick: boolean) => {
    if (!pick) return scan()
    const r = await dialog.showOpenDialog(win!, { title: 'Look for GitHub repos in…', properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? undefined : scan(r.filePaths[0])
  })
  ipcMain.handle('git:link-scanned', (_e, repos: string[]) => {
    const changes: Record<string, string> = {}
    for (const repo of repos) {
      const path = scanned.get(repo.toLowerCase())
      if (path) changes[knownName(repo)] = path
    }
    setLocalPaths(changes)
    return Object.keys(changes).length
  })
  ipcMain.handle('git:unlink', (_e, repo: string) => setLocalPath(repo, null))
  ipcMain.handle('git:status', (_e, repo: string) => (settings.localPaths[repo] ? git.status(localPath(repo)) : null))
  ipcMain.handle('git:log', (_e, repo: string) => git.log(localPath(repo)))
  ipcMain.handle('git:branches', (_e, repo: string) => git.branches(localPath(repo)))
  ipcMain.handle('git:diff', (_e, repo: string, file: string, staged: boolean) => git.diff(localPath(repo), file, staged))
  ipcMain.handle('git:run', async (_e, repo: string, action: GitAction, arg?: string | string[]) => {
    try {
      const output = gitTools.HISTORY_ACTIONS.has(action) ? await gitTools.act(localPath(repo), action, arg) : await git.run(localPath(repo), action, arg)
      // Pushing can start CI runs and change PRs; check GitHub soon.
      if (action === 'push') poller.pollSoon(true)
      return { ok: true, output: output.trim() }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('git:query', (_e, repo: string, q: GitQuery) => gitTools.query(localPath(repo), q))
  ipcMain.handle('git:worktree-add', async (_e, repo: string, branch: string): Promise<ActionResult> => {
    try {
      const path = localPath(repo)
      const name = gitTools.refName(branch)
      const pick = await dialog.showOpenDialog(win!, { title: `Create a worktree for ${name} in…`, properties: ['openDirectory', 'createDirectory'] })
      if (pick.canceled || !pick.filePaths[0]) return { ok: false }
      const target = join(pick.filePaths[0], `${basename(path)}-${name.replace(/[\\/]/g, '-')}`)
      if (existsSync(target)) return { ok: false, error: `${target} already exists` }
      await git.git(path, ['worktree', 'add', target, name])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('deployments:list', (_e, repo: string) => listDeployments(clientFor(repo), repo))
  ipcMain.handle('branches:graph', (_e, repo: string, branches: string[]) => tools.branchGraph(clientFor(repo), repo, branches))
  ipcMain.handle('git:open', async (_e, repo: string, where: 'editor' | 'terminal' | 'folder'): Promise<ActionResult> => {
    try {
      const path = localPath(repo)
      if (where === 'folder') {
        const error = await shell.openPath(path)
        return error ? { ok: false, error } : { ok: true }
      }
      await git.openIn(path, where, resolveEditor(settings.editorCommand, where === 'editor' ? await listEditors() : undefined))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  // --- accounts ---
  ipcMain.handle('accounts:list', async (): Promise<AccountInfo[]> => {
    // The poller's viewer is the active account's, so ask for the primary login when another account is active.
    const primaryLogin =
      settings.activeAccount === 'primary'
        ? poller.snapshot.viewer?.login
        : await primaryClient?.get<{ login: string }>('/user').then((u) => u.login, () => undefined)
    const primary: AccountInfo = {
      id: 'primary',
      name: 'GitHub',
      host: GITHUB_HOST,
      apiUrl: apiUrlFor(GITHUB_HOST),
      primary: true,
      active: settings.activeAccount === 'primary',
      login: primaryLogin,
      status: primaryClient ? 'ok' : 'missing'
    }
    const extra = await Promise.all(
      settings.accounts.map(async (a): Promise<AccountInfo> => {
        const client = accountClients.get(a)
        const active = settings.activeAccount === a.id
        if (!client) return { ...a, primary: false, active, status: 'missing', error: 'No token saved' }
        try {
          return { ...a, primary: false, active, status: 'ok', login: (await client.get<{ login: string }>('/user')).login }
        } catch (err) {
          return { ...a, primary: false, active, status: 'error', error: (err as Error).message }
        }
      })
    )
    return [primary, ...extra]
  })
  ipcMain.handle('accounts:add', async (_e, input: NewAccount): Promise<ActionResult & { id?: string }> => {
    try {
      const host = normalizeHost(input.host)
      if (!host) throw new Error('Enter the host name, such as ghe.example.com (https only)')
      const name = input.name.trim() || host
      const token = input.token.trim()
      if (!token) throw new Error('Paste a personal access token for that host')
      // End-to-end tests point every Enterprise host at a fake server.
      const apiUrl = process.env.PUSHBACK_GHES_API_URL || apiUrlFor(host)
      const login = (await AccountClients.probe(token, apiUrl).get<{ login: string }>('/user')).login // validate before saving
      // One account per host and login: a second github.com login is fine, the same one twice is not.
      const taken = await Promise.all(
        settings.accounts
          .filter((a) => a.host === host)
          .map((a) => accountClients.get(a)?.get<{ login: string }>('/user').then((u) => u.login, () => undefined))
      )
      if (taken.includes(login)) throw new Error(`${login} is already added for ${host}`)
      const id = `acct-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      saveAccountToken(id, token)
      settings = { ...settings, accounts: [...settings.accounts, { id, name, host, apiUrl }] }
      saveSettings(settings)
      send('settings', settings)
      wireAccounts()
      void connect()
      return { ok: true, id }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('accounts:remove', (_e, id: string): ActionResult => {
    const account = settings.accounts.find((a) => a.id === id)
    if (!account) return { ok: false, error: 'No such account' }
    try {
      saveAccountToken(id, null)
      accountClients.forget(id)
      settings = {
        ...settings,
        accounts: settings.accounts.filter((a) => a.id !== id),
        repoAccounts: Object.fromEntries(Object.entries(settings.repoAccounts).filter(([, a]) => a !== id)),
        activeAccount: settings.activeAccount === id ? 'primary' : settings.activeAccount
      }
      saveSettings(settings)
      send('settings', settings)
      wireAccounts()
      void connect()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('accounts:activate', (_e, id: string): ActionResult => {
    if (id !== 'primary' && !settings.accounts.some((a) => a.id === id)) return { ok: false, error: 'No such account' }
    if (id === settings.activeAccount) return { ok: true }
    settings = { ...settings, activeAccount: id }
    saveSettings(settings)
    send('settings', settings)
    void connect() // resets the poller's inbox and repo state, then polls the new account's repos
    return { ok: true }
  })
  ipcMain.handle('accounts:assign', (_e, repo: string, accountId: string | null): ActionResult => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: 'Not a repository name' }
    if (accountId && !settings.accounts.some((a) => a.id === accountId)) return { ok: false, error: 'No such account' }
    const repoAccounts = { ...settings.repoAccounts }
    if (accountId) repoAccounts[repo] = accountId
    else delete repoAccounts[repo]
    settings = { ...settings, repoAccounts }
    saveSettings(settings)
    send('settings', settings)
    return { ok: true }
  })
  // --- stale cleanup ---
  ipcMain.handle('cleanup:prs', (_e, repo: string) => listOpenPrs(clientFor(repo), repo))
  ipcMain.handle('cleanup:apply', async (_e, repo: string, req: CleanupRequest) => {
    const result = await applyCleanup(clientFor(repo), repo, req)
    poller.pollSoon()
    return result
  })
  // --- merge status ---
  ipcMain.handle('pr:merge-status', (_e, repo: string, num: number) => fetchMergeStatus(clientFor(repo), repo, num))
  // --- security alerts ---
  ipcMain.handle('security:list', (_e, repo: string) => listSecurity(clientFor(repo), repo))
  // --- packages (the primary login's: GitHub Packages for you and your organisations) ---
  ipcMain.handle('packages:list', (_e, owner: string) => listPackages(activeClient(), String(owner)))
  ipcMain.handle('packages:orgs', () => listPackageOrgs(activeClient()))
  ipcMain.handle('packages:versions', (_e, owner: string, type: string, name: string) => packageVersions(activeClient(), String(owner), String(type), String(name)))
  ipcMain.handle('editors:list', () => listEditors())
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => {
    quitting = true
    installUpdate()
  })
  // --- merge queue ---
  ipcMain.handle('merge-queue:get', (_e, repo: string, branch?: string) => fetchMergeQueue(clientFor(repo), repo, branch ? String(branch) : undefined))
  // --- workflow files ---
  ipcMain.handle('workflow:file', (_e, repo: string, path: string, ref?: string) => fetchWorkflowFile(clientFor(repo), repo, String(path), ref ? String(ref) : undefined))
}

// A throwaway profile for the end-to-end tests. Set before the single-instance lock, which is keyed on the
// profile folder, so a test run doesn't collide with a Pushback you have open.
if (process.env.PUSHBACK_USER_DATA) app.setPath('userData', process.env.PUSHBACK_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  // Windows only shows toasts for an AppUserModelID that has a Start-menu shortcut. The installer
  // registers our appId; an unpackaged dev build has no shortcut, so use Electron's own exe path there.
  app.setAppUserModelId(app.isPackaged ? 'dev.pushback.app' : process.execPath)
  if (!process.env.PUSHBACK_USER_DATA) migrateUserData()

  app.whenReady().then(() => {
    settings = loadSettings()
    poller.snapshot.events = loadEvents()
    registerIpc()
    createWindow()
    createTray()
    applyLoginItem()
    void connect()
    initUpdater(
      (s) => send('update', s),
      () => settings.autoUpdate
    )
    app.on('activate', showWindow)
    // In "system" mode the OS switching light/dark changes the theme, and the window controls need to follow.
    nativeTheme.on('updated', paintWindow)
    // After the first poll, so the scan's disk reads don't slow down startup.
    setTimeout(() => void autoLinkClones().catch(() => {}), 15_000)
  })

  app.on('before-quit', () => {
    quitting = true
    poller.stop()
  })
  app.on('window-all-closed', () => {
    if (!settings.closeToTray) app.quit()
  })
}

/** The app was called RepoDeck before 0.2 and Flightdeck in 0.2; carry settings, history and token over once. */
function migrateUserData(): void {
  const dir = app.getPath('userData')
  if (existsSync(join(dir, 'settings.json'))) return
  const old = ['Flightdeck', 'RepoDeck', 'repodeck'].map((name) => join(dirname(dir), name)).find((d) => existsSync(join(d, 'settings.json')))
  if (!old) return
  for (const name of ['settings.json', 'events.json', 'token.bin']) if (existsSync(join(old, name))) cpSync(join(old, name), join(dir, name))
}

interface GhJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  html_url: string
  steps?: { name: string; status: string; conclusion: string | null; number: number; started_at?: string; completed_at?: string }[]
}
