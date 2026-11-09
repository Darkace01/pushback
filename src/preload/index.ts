import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PushbackApi, Settings, Snapshot, UpdateStatus } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PushbackApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  onSnapshot: (cb) => subscribe<Snapshot>('snapshot', cb),
  onSettings: (cb) => subscribe<Settings>('settings', cb),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setToken: (token) => ipcRenderer.invoke('auth:set', token),
  refresh: () => ipcRenderer.invoke('poll:now'),
  listMyRepos: (accountId) => ipcRenderer.invoke('repos:mine', accountId),
  dispatch: (repo, workflowId, ref, inputs) => ipcRenderer.invoke('wf:dispatch', repo, workflowId, ref, inputs),
  rerun: (repo, runId, failedOnly) => ipcRenderer.invoke('run:rerun', repo, runId, failedOnly),
  cancel: (repo, runId) => ipcRenderer.invoke('run:cancel', repo, runId),
  runJobs: (repo, runId) => ipcRenderer.invoke('run:jobs', repo, runId),
  jobLog: (repo, jobId) => ipcRenderer.invoke('job:log', repo, jobId),
  approvePr: (repo, num) => ipcRenderer.invoke('pr:approve', repo, num),
  mergePr: (repo, num, method) => ipcRenderer.invoke('pr:merge', repo, num, method),
  reviewPr: (repo, num, event, body) => ipcRenderer.invoke('pr:review', repo, num, event, body),
  autoMergePr: (repo, num, method, enable) => ipcRenderer.invoke('pr:auto-merge', repo, num, method, enable),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: (json) => ipcRenderer.invoke('settings:import', json),
  openExternal: (url) => ipcRenderer.invoke('open', url),
  saveTextFile: (defaultName, content) => ipcRenderer.invoke('file:save-text', defaultName, content),
  openTextFile: () => ipcRenderer.invoke('file:open-text'),
  markRead: (ids) => ipcRenderer.invoke('events:read', ids),
  clearEvents: () => ipcRenderer.invoke('events:clear'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdate: (cb) => subscribe<UpdateStatus>('update', cb),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  prDetail: (repo, num) => ipcRenderer.invoke('pr:detail', repo, num),
  commentPr: (repo, num, body) => ipcRenderer.invoke('pr:comment', repo, num, body),
  repoInfo: (repo) => ipcRenderer.invoke('repo:info', repo),
  listIssues: (repo, state) => ipcRenderer.invoke('issues:list', repo, state),
  issueDetail: (repo, num) => ipcRenderer.invoke('issue:detail', repo, num),
  createIssue: (repo, issue) => ipcRenderer.invoke('issue:create', repo, issue),
  setIssueState: (repo, num, state, reason) => ipcRenderer.invoke('issue:state', repo, num, state, reason),
  listLabels: (repo) => ipcRenderer.invoke('labels:list', repo),
  runSearch: (query, kind) => ipcRenderer.invoke('search:run', query, kind),
  listBranches: (repo, defaultBranch) => ipcRenderer.invoke('branches:list', repo, defaultBranch),
  createBranch: (repo, name, from) => ipcRenderer.invoke('branch:create', repo, name, from),
  deleteBranch: (repo, name) => ipcRenderer.invoke('branch:delete', repo, name),
  listCommits: (repo, ref) => ipcRenderer.invoke('commits:list', repo, ref),
  listReleases: (repo) => ipcRenderer.invoke('releases:list', repo),
  createRelease: (repo, release) => ipcRenderer.invoke('release:create', repo, release),
  createPr: (repo, pr) => ipcRenderer.invoke('pr:create', repo, pr),
  releaseDraft: (repo, base) => ipcRenderer.invoke('release:draft', repo, base),
  gitLink: (repo) => ipcRenderer.invoke('git:link', repo),
  gitClone: (repo) => ipcRenderer.invoke('git:clone', repo),
  gitUnlink: (repo) => ipcRenderer.invoke('git:unlink', repo),
  gitStatus: (repo) => ipcRenderer.invoke('git:status', repo),
  gitLog: (repo) => ipcRenderer.invoke('git:log', repo),
  gitBranches: (repo) => ipcRenderer.invoke('git:branches', repo),
  gitDiff: (repo, file, staged) => ipcRenderer.invoke('git:diff', repo, file, staged),
  gitRun: (repo, action, arg) => ipcRenderer.invoke('git:run', repo, action, arg),
  gitOpen: (repo, where) => ipcRenderer.invoke('git:open', repo, where),
  gitQuery: (repo, query) => ipcRenderer.invoke('git:query', repo, query),
  gitAddWorktree: (repo, branch) => ipcRenderer.invoke('git:worktree-add', repo, branch),
  branchGraph: (repo, branches) => ipcRenderer.invoke('branches:graph', repo, branches),
  listDeployments: (repo) => ipcRenderer.invoke('deployments:list', repo),
  listEditors: () => ipcRenderer.invoke('editors:list'),
  scanClones: (pick) => ipcRenderer.invoke('git:scan', pick),
  linkScanned: (repos) => ipcRenderer.invoke('git:link-scanned', repos),
  // --- accounts ---
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (account) => ipcRenderer.invoke('accounts:add', account),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  setActiveAccount: (id) => ipcRenderer.invoke('accounts:activate', id),
  setRepoAccount: (repo, accountId) => ipcRenderer.invoke('accounts:assign', repo, accountId),
  // --- stale cleanup ---
  listOpenPrs: (repo) => ipcRenderer.invoke('cleanup:prs', repo),
  cleanup: (repo, req) => ipcRenderer.invoke('cleanup:apply', repo, req),
  // --- merge status ---
  prMergeStatus: (repo, num) => ipcRenderer.invoke('pr:merge-status', repo, num),
  // --- security alerts ---
  listSecurity: (repo) => ipcRenderer.invoke('security:list', repo),
  // --- packages ---
  listPackages: (owner) => ipcRenderer.invoke('packages:list', owner),
  listPackageOrgs: () => ipcRenderer.invoke('packages:orgs'),
  packageVersions: (owner, type, name) => ipcRenderer.invoke('packages:versions', owner, type, name),
  // --- deployment approvals ---
  pendingDeployments: (repo, runId) => ipcRenderer.invoke('approvals:get', repo, runId),
  reviewDeployments: (repo, runId, ids, state, comment) => ipcRenderer.invoke('approvals:review', repo, runId, ids, state, comment),
  // --- run artifacts ---
  runArtifacts: (repo, runId) => ipcRenderer.invoke('run:artifacts', repo, runId),
  downloadArtifact: (repo, id, name) => ipcRenderer.invoke('artifact:download', repo, id, name),
  // --- inline review ---
  prThreads: (repo, num) => ipcRenderer.invoke('pr:threads', repo, num),
  commentLine: (repo, num, comment) => ipcRenderer.invoke('pr:line-comment', repo, num, comment),
  replyToThread: (repo, num, commentId, body) => ipcRenderer.invoke('pr:reply', repo, num, commentId, body),
  resolveThread: (repo, threadId, resolved) => ipcRenderer.invoke('pr:resolve-thread', repo, threadId, resolved),
  // --- GitHub notifications ---
  readNotifications: (threadId) => ipcRenderer.invoke('notifications:read', threadId),
  onNavigate: (cb) => subscribe<string>('navigate', cb)
}

contextBridge.exposeInMainWorld('pushback', api)
