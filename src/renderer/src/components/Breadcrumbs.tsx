import type { ModalState } from '../lib/ui'
import { closeModal, isPage, popTo, useModal, useTrail } from '../lib/ui'
import { getSnapshot, useSettings } from '../lib/store'
import { HOME, openRepoTab, useRepoSection } from '../lib/tabs'
import { RunDetailsModal } from './ActionModals'
import { IssueModal } from './IssueView'
import { MergeQueueModal } from './MergeQueue'
import { PrModal } from './PrView'
import { SECTIONS } from './RepoWorkspace'
import { WorkflowFileModal } from './WorkflowFile'
import { Icon, PageMode } from './ui'

type Page = NonNullable<ModalState> & ({ kind: 'pr' } | { kind: 'issue' } | { kind: 'run' } | { kind: 'merge-queue' } | { kind: 'workflow-file' })

const pageRepo = (p: Page) => (p.kind === 'run' ? p.run.repo : p.repo)

function pageLabel(p: Page): string {
  if (p.kind === 'run') return `${p.run.name} #${p.run.runNumber}`
  if (p.kind === 'issue') return `Issue #${p.number}`
  if (p.kind === 'merge-queue') return `Merge queue${p.branch ? ` (${p.branch})` : ''}`
  if (p.kind === 'workflow-file') return p.name ?? p.path.split('/').pop()!
  const title = getSnapshot().repos[p.repo]?.prs.find((x) => x.number === p.number)?.title
  return `#${p.number}${title ? ` ${title}` : ''}`
}

/** The open pages in the trail, with their positions (dialogs such as merge sit in the trail too, but aren't pages). */
export function usePages() {
  const trail = useTrail()
  return trail.flatMap((m, i) => (isPage(m) ? [{ page: m as Page, index: i }] : []))
}

/**
 * Where you are: the tab (dashboard or repo › section), then every page opened on top of it. Click any
 * crumb to go back up to it.
 */
export function Breadcrumbs() {
  const settings = useSettings()
  const pages = usePages()
  const tabRepo = settings.activeTab === HOME ? null : settings.activeTab
  const section = useRepoSection(tabRepo ?? '')
  const dashboard = settings.dashboards.find((d) => d.id === settings.activeDashboard)
  const crumbs: { label: string; onClick?: () => void; icon?: boolean }[] = []

  if (tabRepo) {
    crumbs.push({ label: tabRepo, onClick: () => popTo(-1) })
    crumbs.push({ label: SECTIONS.find((s) => s.id === section)?.label ?? 'Overview', onClick: () => popTo(-1) })
  } else crumbs.push({ label: dashboard?.name ?? 'Dashboard', onClick: () => popTo(-1), icon: true })

  let repo = tabRepo
  for (const { page, index } of pages) {
    const r = pageRepo(page)
    // A page from another repo than the one you're in gets its repo as a crumb, which opens that repo's tab.
    if (r !== repo) crumbs.push({ label: r, onClick: () => openRepoTab(r) })
    repo = r
    crumbs.push({ label: pageLabel(page), onClick: () => popTo(index) })
  }

  return (
    <nav className="crumbs" aria-label="You are here">
      {pages.length > 0 && (
        <button className="crumb-back" title="Back (Esc)" onClick={closeModal}>
          ←
        </button>
      )}
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={i} aria-current={last ? 'page' : undefined}>
              {last ? (
                <span className="crumb current">{c.label}</span>
              ) : (
                <button className="crumb" onClick={c.onClick}>
                  {c.icon && <Icon name="grid" size={12} />} {c.label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {pages.length > 0 && <span className="crumb-depth dim small">level {crumbs.length}</span>}
    </nav>
  )
}

/** The topmost page, shown in the main area. Inside a repo tab for the same repo, its rail is left out. */
export function PageArea({ inRepo }: { inRepo?: string }) {
  const pages = usePages()
  const top = useModal()
  const last = pages[pages.length - 1]
  if (!last) return null
  const { page } = last
  const view =
    page.kind === 'pr' ? (
      <PrModal key={`${page.repo}#${page.number}`} repo={page.repo} number={page.number} />
    ) : page.kind === 'issue' ? (
      <IssueModal key={`${page.repo}#${page.number}`} repo={page.repo} number={page.number} />
    ) : page.kind === 'merge-queue' ? (
      <MergeQueueModal key={`${page.repo}@${page.branch ?? ''}`} repo={page.repo} branch={page.branch} />
    ) : page.kind === 'workflow-file' ? (
      <WorkflowFileModal key={`${page.repo}/${page.path}@${page.ref ?? ''}`} repo={page.repo} path={page.path} ref={page.ref} name={page.name} />
    ) : (
      <RunDetailsModal key={page.run.id} run={page.run} />
    )
  return (
    <PageMode.Provider value={{ page: true, top: top === page, rail: inRepo !== pageRepo(page) }}>
      <div className="page-area">{view}</div>
    </PageMode.Provider>
  )
}
