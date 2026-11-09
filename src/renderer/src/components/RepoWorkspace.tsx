import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { WIDGET_DEFAULTS } from '../../../shared/defaults'
import type { RepoInfo, WidgetType } from '../../../shared/types'
import { timeAgo, useNow } from '../lib/format'
import { webUrl } from '../lib/hosts'
import { api, toast, updateSettings, useSettings, useSnapshot } from '../lib/store'
import { setRepoSection, useRepoSection } from '../lib/tabs'
import { pushModal } from '../lib/ui'
import { CiHealthWidget } from '../widgets/CiHealthWidget'
import { InsightsWidget } from '../widgets/InsightsWidget'
import { PrsWidget } from '../widgets/PrsWidget'
import { RunsWidget } from '../widgets/RunsWidget'
import type { WidgetProps } from '../widgets/types'
import { SecurityWidget } from '../widgets/SecurityWidget'
import { WorkflowsWidget } from '../widgets/WorkflowsWidget'
import { ActionsSettingsSection } from './ActionsSettings'
import { CleanupSection } from './Cleanup'
import { BranchesSection, CommitsSection, IssuesSection, ReleasesSection } from './GitHubSections'
import { CompareSection, ContributorsSection, FileHistorySection, GraphSection, RemotesSection, SearchSection, StashesSection, TagsSection } from './GitTools'
import { DeploymentsSection } from './Deployments'
import { DiscussionsSection } from './Discussions'
import { CollapsibleFilterBar } from './FilterBar'
import { LocalSection } from './LocalGit'
import { Markdown } from './Markdown'
import { MergeQueueSection } from './MergeQueue'
import { Empty, runTone, Skeleton, StatusIcon } from './ui'

export interface SectionProps {
  repo: string
  info?: RepoInfo
}

interface Section {
  id: string
  label: string
  group: 'GitHub' | 'Actions' | 'Local'
  /** Sections built from dashboard widgets need the repo to be watched (polled). */
  widget?: [WidgetType, ComponentType<WidgetProps>]
  component?: ComponentType<SectionProps>
  count?: (repo: string) => number | undefined
}

function Overview({ repo, info }: SectionProps) {
  if (!info) return <Skeleton kind="text" rows={8} />
  return info.readmeHtml ? (
    <div className="readme">
      <Markdown html={info.readmeHtml} repo={repo} branch={info.defaultBranch} />
    </div>
  ) : (
    <Empty>This repository has no README.</Empty>
  )
}

/** The sections every repo tab has. Later features add entries here. */
export const SECTIONS: Section[] = [
  { id: 'overview', label: 'Overview', group: 'GitHub', component: Overview },
  { id: 'pulls', label: 'Pull requests', group: 'GitHub', widget: ['prs', PrsWidget] },
  { id: 'merge-queue', label: 'Merge queue', group: 'GitHub', component: MergeQueueSection },
  { id: 'issues', label: 'Issues', group: 'GitHub', component: IssuesSection },
  { id: 'discussions', label: 'Discussions', group: 'GitHub', component: DiscussionsSection },
  { id: 'branches', label: 'Branches', group: 'GitHub', component: BranchesSection },
  { id: 'commits', label: 'Commits', group: 'GitHub', component: CommitsSection },
  { id: 'releases', label: 'Releases', group: 'GitHub', component: ReleasesSection },
  { id: 'cleanup', label: 'Stale cleanup', group: 'GitHub', component: CleanupSection },
  { id: 'security', label: 'Security', group: 'GitHub', widget: ['security', SecurityWidget] },
  { id: 'runs', label: 'Runs', group: 'Actions', widget: ['runs', RunsWidget] },
  { id: 'workflows', label: 'Workflows', group: 'Actions', widget: ['workflows', WorkflowsWidget] },
  { id: 'insights', label: 'Insights', group: 'Actions', widget: ['insights', InsightsWidget] },
  { id: 'cihealth', label: 'CI health', group: 'Actions', widget: ['cihealth', CiHealthWidget] },
  { id: 'deployments', label: 'Deployments', group: 'Actions', component: DeploymentsSection },
  { id: 'actions-settings', label: 'Actions settings', group: 'Actions', component: ActionsSettingsSection },
  { id: 'local', label: 'Working copy', group: 'Local', component: LocalSection },
  { id: 'graph', label: 'Commit graph', group: 'Local', component: GraphSection },
  { id: 'file-history', label: 'File history & blame', group: 'Local', component: FileHistorySection },
  { id: 'compare', label: 'Compare', group: 'Local', component: CompareSection },
  { id: 'search', label: 'Search commits', group: 'Local', component: SearchSection },
  { id: 'stashes', label: 'Stashes', group: 'Local', component: StashesSection },
  { id: 'tags', label: 'Tags', group: 'Local', component: TagsSection },
  { id: 'remotes', label: 'Remotes & worktrees', group: 'Local', component: RemotesSection },
  { id: 'contributors', label: 'Contributors', group: 'Local', component: ContributorsSection }
]


/** A repo's tab. `page` (a PR, issue or run opened from it) replaces the section content, keeping the section nav. */
/** A dashboard widget shown as a repo section, with its own filters (kept while the tab is open). */
function SectionWidget({ repo, type, Body }: { repo: string; type: WidgetType; Body: ComponentType<WidgetProps> }) {
  const defaults = WIDGET_DEFAULTS[type].options as Record<string, string | number | boolean>
  const [options, setOptions] = useState(defaults)
  return (
    <div className="repo-tab">
      <CollapsibleFilterBar type={type} scope={[repo]} options={options} defaults={defaults} onChange={(p) => p.options && setOptions(p.options)} />
      <Body widget={{ id: `repo-${type}`, type, repos: [repo], options }} filter="" />
    </div>
  )
}

export function RepoWorkspace({ repo, page }: { repo: string; page?: ReactNode }) {
  const settings = useSettings()
  const snapshot = useSnapshot()
  const now = useNow()
  const state = snapshot.repos[repo]
  const tracked = settings.repos.includes(repo)
  const [info, setInfo] = useState<RepoInfo>()
  const [error, setError] = useState<string>()
  const section = useRepoSection(repo)
  const setSection = (id: string) => setRepoSection(repo, id)

  // Wait for sign-in: a tab restored at launch mounts before the first poll has loaded the token.
  const signedIn = snapshot.auth === 'ok'
  useEffect(() => {
    if (!signedIn) return
    setError(undefined)
    api.repoInfo(repo).then(setInfo, (e: Error) => setError(e.message))
  }, [repo, signedIn])

  const latest = state?.runs.find((r) => r.branch === (info?.defaultBranch ?? state.defaultBranch) && r.status === 'completed')
  const running = state?.runs.filter((r) => r.status !== 'completed').length ?? 0
  const counts: Record<string, number | undefined> = { pulls: state?.prs.length, runs: running || undefined }
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const groups = [...new Set(SECTIONS.map((s) => s.group))]

  return (
    <div className="workspace">
      <aside className="ws-nav">
        {groups.map((g) => (
          <div key={g} className="ws-group">
            <div className="ws-group-label">{g}</div>
            {SECTIONS.filter((s) => s.group === g).map((s) => {
              const n = counts[s.id] ?? s.count?.(repo)
              return (
                <button key={s.id} className={`ws-link${s.id === current.id ? ' on' : ''}`} onClick={() => setSection(s.id)}>
                  {s.label}
                  {!!n && <span className="count">{n}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      <main className="ws-main">
        {page ?? (
          <>
        <header className="pr-head">
          <h1 className="pr-title">
            <span>
              <span className="dim">{repo.split('/')[0]}/</span>
              {repo.split('/')[1]}
            </span>
            {info?.private && <span className="badge badge-muted">Private</span>}
            {info?.archived && <span className="badge badge-warn">Archived</span>}
          </h1>
          {info?.description && <p>{info.description}</p>}
          {info && (
            <div className="row-meta">
              {latest && (
                <span className="inline">
                  <StatusIcon tone={runTone(latest)} size={13} /> {info.defaultBranch}
                </span>
              )}
              {info.language && <span>{info.language}</span>}
              <span>★ {info.stars.toLocaleString()}</span>
              <span>⑂ {info.forks.toLocaleString()}</span>
              <span>pushed {timeAgo(info.pushedAt, now)}</span>
              {info.homepage && (
                <button className="link" onClick={() => void api.openExternal(info.homepage!)}>
                  {info.homepage.replace(/^https?:\/\//, '')}
                </button>
              )}
              {info.topics.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="inline">
            <button
              className={`btn btn-sm${tracked ? '' : ' btn-primary'}`}
              onClick={() => {
                void updateSettings({ repos: tracked ? settings.repos.filter((r) => r !== repo) : [...settings.repos, repo] })
                toast(tracked ? `Stopped watching ${repo}` : `Watching ${repo}`, 'ok')
              }}
            >
              {tracked ? 'Watching ✓' : '+ Watch'}
            </button>
            <button className="btn btn-sm" onClick={() => pushModal({ kind: 'new-pr', repo })}>
              New pull request
            </button>
            <button className="btn btn-sm" onClick={() => pushModal({ kind: 'new-issue', repo })}>
              New issue
            </button>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(`gh repo clone ${repo}`).then(() => toast('Clone command copied', 'ok'))}>
              Copy clone command
            </button>
            <button className="btn btn-sm" onClick={() => void api.openExternal(webUrl(repo))}>
              Open in browser
            </button>
          </div>
        </header>

        {error && <p className="del">Couldn't load {repo}: {error}</p>}

        {current.component && !(error && !info) && <current.component repo={repo} info={info} />}
        {current.widget &&
          (tracked && !state ? (
            <Skeleton rows={6} />
          ) : tracked ? (
            <SectionWidget key={current.id} repo={repo} type={current.widget[0]} Body={current.widget[1]} />
          ) : (
            <Empty>Watch this repo to see its {current.label.toLowerCase()} here. Watched repos are refreshed in the background.</Empty>
          ))}
          </>
        )}
      </main>
    </div>
  )
}
