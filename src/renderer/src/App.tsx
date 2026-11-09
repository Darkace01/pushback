import { useEffect } from 'react'
import { DispatchModal, MergeModal, ReviewModal, RunDetailsModal } from './components/ActionModals'
import { Dashboard } from './components/Dashboard'
import { SavedSearchesModal } from './components/SavedSearches'
import { AccountSwitcher } from './components/AccountSwitcher'
import { DashboardTabs, ImportDashboardModal, ManageDashboardsModal, NewDashboardModal, ShareDashboardModal } from './components/Dashboards'
import { Palette } from './components/Palette'
import { PrModal } from './components/PrView'
import { NewIssueModal, NewPrModal, NewReleaseModal } from './components/CreateModals'
import { IssueModal } from './components/IssueView'
import { RepoWorkspace } from './components/RepoWorkspace'
import { Breadcrumbs, PageArea } from './components/Breadcrumbs'
import { FindClonesModal } from './components/FindClones'
import { ActivityModal, ACTIVITY_TARGET } from './components/Activity'
import { RepoSidebar, TabBar } from './components/Tabs'
import { Tour } from './components/Tour'
import { AccountSection, ReposSection, SettingsModal } from './components/SettingsModal'
import { Avatar, Icon, IconButton, Toasts } from './components/ui'
import { AddWidgetModal, WidgetSettingsModal } from './components/WidgetModals'
import { timeAgo, useNow } from './lib/format'
import { api, getSettings, useSettings, useSnapshot, useUpdate } from './lib/store'
import { switchDashboard } from './lib/dashboards'
import { openInApp } from './lib/open'
import { cycleTab, HOME, toggleSidebar } from './lib/tabs'
import { useApplyAppearance } from './lib/theme'
import { closeModal, isPage, openModal, setEditing, useEditing, useModal, useTrail } from './lib/ui'

function useShortcuts(): void {
  const editing = useEditing()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openModal({ kind: 'palette' })
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      } else if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const d = getSettings().dashboards[Number(e.key) - 1]
        if (d) switchDashboard(d.id)
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (mod && e.key === ',') {
        e.preventDefault()
        openModal({ kind: 'settings' })
      } else if ((mod && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault() // refresh data, not the window
        void api.refresh()
      } else if (!typing && !mod && e.key.toLowerCase() === 'e') {
        setEditing(!editing)
      } else if (!typing && e.key === 'Escape' && editing) {
        setEditing(false)
      } else if (!typing && e.key === '/') {
        e.preventDefault()
        openModal({ kind: 'palette' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])
}

/** The app icon (a launch arrow over a runway) in black and white, following the theme's text and background. */
function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 20 20" aria-hidden>
      <rect width="20" height="20" rx="4.4" fill="var(--text)" />
      <g fill="var(--bg)">
        <polygon transform="translate(10 9.2) rotate(45) translate(-10 -10)" points="10,2.4 14.2,8.4 11.4,8.4 11.4,14.8 8.6,14.8 8.6,8.4 5.8,8.4" />
        <g opacity="0.7">
          <rect x="4" y="15.6" width="2.4" height="1.2" />
          <rect x="8.8" y="15.6" width="2.4" height="1.2" />
          <rect x="13.6" y="15.6" width="2.4" height="1.2" />
        </g>
      </g>
    </svg>
  )
}

function UpdateButton() {
  const update = useUpdate()
  if (update.state === 'ready')
    return (
      <button className="btn btn-sm btn-primary" title="Restarts Pushback to finish updating" onClick={() => void api.installUpdate()}>
        Restart to update
      </button>
    )
  if (update.state === 'available' && !update.canInstall)
    return (
      <button className="btn btn-sm btn-primary" onClick={() => void api.openExternal(update.url!)}>
        Get v{update.version}
      </button>
    )
  return null
}

function TopBar() {
  const snapshot = useSnapshot()
  const settings = useSettings()
  const editing = useEditing()
  const now = useNow(5000)
  const rate = snapshot.rateLimit
  const gql = snapshot.graphqlRateLimit
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <header className="topbar">
      <IconButton icon="sidebar" title="Show or hide the repo sidebar (Ctrl+B)" active={settings.sidebarOpen} onClick={toggleSidebar} />
      <div className="brand">
        <Logo />
        Pushback
      </div>
      <DashboardTabs />
      <AccountSwitcher />
      <button className="search-trigger" onClick={() => openModal({ kind: 'palette' })}>
        <Icon name="search" />
        Search or run a command…
        <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <div className="topbar-status">
        <span title={snapshot.nextPoll ? `Next refresh ${new Date(snapshot.nextPoll).toLocaleTimeString()}` : undefined}>
          <span className={`pulse${snapshot.polling ? ' busy' : ''}`} />
          {snapshot.polling ? 'Refreshing…' : snapshot.lastPoll ? `Updated ${timeAgo(snapshot.lastPoll, now)}` : 'Waiting…'}
        </span>
        {rate && (
          <span title={`GitHub's REST budget (runs, workflows, repo views). Resets ${new Date(rate.reset).toLocaleTimeString()}`} className={rate.remaining < rate.limit * 0.1 ? 'del' : undefined}>
            API {rate.remaining.toLocaleString()}/{rate.limit.toLocaleString()}
          </span>
        )}
        {gql && (
          <span
            title={`GitHub's GraphQL budget (pull requests, inbox, deployments). Resets ${new Date(gql.reset).toLocaleTimeString()}`}
            className={gql.remaining < gql.limit * 0.1 ? 'del' : undefined}
          >
            GraphQL {gql.remaining.toLocaleString()}/{gql.limit.toLocaleString()}
          </span>
        )}
      </div>
      <UpdateButton />
      <IconButton icon="refresh" title="Refresh now (Ctrl+R)" onClick={() => void api.refresh()} />
      <IconButton icon="grid" title={editing ? 'Done editing (E)' : 'Edit layout (E)'} active={editing} onClick={() => setEditing(!editing)} />
      <IconButton icon="gear" title="Settings (Ctrl+,)" onClick={() => openModal({ kind: 'settings' })} />
      {snapshot.viewer && <Avatar src={snapshot.viewer.avatarUrl} login={snapshot.viewer.login} size={24} />}
    </header>
  )
}

function Onboarding() {
  const snapshot = useSnapshot()
  const signedIn = snapshot.auth === 'ok'
  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <h1>{signedIn ? 'Pick repositories to watch' : 'Connect to GitHub'}</h1>
        {signedIn ? (
          <>
            <p className="dim">Choose the repos whose Actions and pull requests you want on your dashboard. You can change this any time in Settings.</p>
            <ReposSection />
          </>
        ) : (
          <>
            <p className="dim">The quickest way is the GitHub CLI — Pushback picks up its login automatically:</p>
            <pre>
              <code>gh auth login</code>
            </pre>
            <button className="btn" onClick={() => void api.refresh()}>
              I've signed in with gh — check again
            </button>
            <p className="dim">Or paste a personal access token:</p>
            <AccountSection />
          </>
        )}
      </div>
    </div>
  )
}

/** Dialogs only: PRs, issues and runs open as pages (see PageArea). */
function Modals() {
  const modal = useModal()
  if (!modal || isPage(modal)) return null
  switch (modal.kind) {
    case 'settings':
      return <SettingsModal />
    case 'palette':
      return <Palette />
    case 'widget':
      return <WidgetSettingsModal id={modal.id} />
    case 'add-widget':
      return <AddWidgetModal />
    case 'dispatch':
      return <DispatchModal workflow={modal.workflow} />
    case 'run':
      return <RunDetailsModal run={modal.run} />
    case 'merge':
      return <MergeModal pr={modal.pr} />
    case 'review':
      return <ReviewModal pr={modal.pr} />
    case 'pr':
      return <PrModal key={`${modal.repo}#${modal.number}`} repo={modal.repo} number={modal.number} />
    case 'issue':
      return <IssueModal key={`${modal.repo}#${modal.number}`} repo={modal.repo} number={modal.number} />
    case 'new-pr':
      return <NewPrModal repo={modal.repo} head={modal.head} />
    case 'new-issue':
      return <NewIssueModal repo={modal.repo} />
    case 'new-release':
      return <NewReleaseModal repo={modal.repo} />
    case 'new-dashboard':
      return <NewDashboardModal />
    case 'dashboards':
      return <ManageDashboardsModal />
    case 'share-dashboard':
      return <ShareDashboardModal id={modal.id} />
    case 'import-dashboard':
      return <ImportDashboardModal />
    case 'saved-searches':
      return <SavedSearchesModal />
    case 'find-clones':
      return <FindClonesModal />
    case 'activity':
      return <ActivityModal />
  }
}

export function App() {
  const snapshot = useSnapshot()
  const settings = useSettings()
  useApplyAppearance()
  useShortcuts()
  useEffect(() => closeModal, [])
  // A digest notification asks for Activity; every other click opens a GitHub link.
  useEffect(() => api.onNavigate((url) => (url === ACTIVITY_TARGET ? openModal({ kind: 'activity' }) : openInApp(url))), [])

  // Until the first poll answers, auth reads as missing; show the dashboard's skeleton rather than flashing sign-in.
  const starting = !snapshot.lastPoll && settings.repos.length > 0
  const ready = starting || (snapshot.auth === 'ok' && settings.repos.length > 0)
  const hasPage = useTrail().some(isPage)
  return (
    <div className="app">
      <TopBar />
      {ready ? (
        <div className="app-body">
          {settings.sidebarOpen && <RepoSidebar />}
          <div className="app-main">
            {settings.tabLayout === 'horizontal' && <TabBar />}
            <Breadcrumbs />
            {settings.activeTab === HOME ? (
              hasPage ? <PageArea /> : <Dashboard />
            ) : (
              <RepoWorkspace key={settings.activeTab} repo={settings.activeTab} page={hasPage ? <PageArea inRepo={settings.activeTab} /> : undefined} />
            )}
          </div>
        </div>
      ) : (
        <Onboarding />
      )}
      <Modals />
      {ready && !starting && !settings.tourDone && <Tour />}
      <Toasts />
    </div>
  )
}
