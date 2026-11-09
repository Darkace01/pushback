import { api, getSettings, getSnapshot } from './store'
import { knownHosts } from './hosts'
import { openRepoTab } from './tabs'
import { pushModal } from './ui'

// github.com/<these>/… are site pages, not owner/repo.
const RESERVED = new Set([
  'settings', 'orgs', 'organizations', 'users', 'marketplace', 'notifications', 'apps', 'sponsors', 'topics', 'features',
  'login', 'about', 'pricing', 'enterprise', 'explore', 'codespaces', 'search', 'new', 'issues', 'pulls', 'collections'
])

/**
 * Opens a GitHub link inside Pushback when there's a view for it (PR, workflow run, repo),
 * otherwise in the browser. Every click on GitHub content should go through here.
 */
export function openInApp(url: string): void {
  const m = url.match(/^https:\/\/([\w.:-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(\/[^?#]*)?(?:[?#].*)?$/)
  if (!m || !knownHosts().includes(m[1].toLowerCase()) || RESERVED.has(m[2])) return void api.openExternal(url)
  const repo = `${m[2]}/${m[3]}`
  // A link on an Enterprise host only opens in the app if that repo is routed to the host's account.
  const host = getSettings().accounts.find((a) => a.host === m[1].toLowerCase())
  if (host && getSettings().repoAccounts[repo] !== host.id) return void api.openExternal(url)
  const rest = m[4] ?? ''

  const pr = rest.match(/^\/pull\/(\d+)/)
  if (pr) return pushModal({ kind: 'pr', repo, number: Number(pr[1]) })

  const issue = rest.match(/^\/issues\/(\d+)/)
  if (issue) return pushModal({ kind: 'issue', repo, number: Number(issue[1]) })

  const discussion = rest.match(/^\/discussions\/(\d+)/)
  if (discussion) return pushModal({ kind: 'discussion', repo, number: Number(discussion[1]) })

  const run = rest.match(/^\/actions\/runs\/(\d+)/)
  if (run) {
    const found = getSnapshot().repos[repo]?.runs.find((r) => r.id === Number(run[1]))
    // Runs we haven't polled (old, or untracked repo) have no data to show yet.
    return found ? pushModal({ kind: 'run', run: found }) : void api.openExternal(url)
  }

  if (rest === '' || rest === '/') return openRepoTab(repo)
  void api.openExternal(url)
}

export const openPr = (repo: string, number: number) => pushModal({ kind: 'pr', repo, number })
export const openIssue = (repo: string, number: number) => pushModal({ kind: 'issue', repo, number })
export const openRepo = openRepoTab
export const openDiscussion = (repo: string, number: number) => pushModal({ kind: 'discussion', repo, number })
