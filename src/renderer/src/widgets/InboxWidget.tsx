import { memo } from 'react'
import type { Inbox } from '../../../shared/types'
import { canApprove, environmentNames } from '../../../shared/approvals'
import { reasonLabel } from '../../../shared/notifications'
import { Avatar, checksTone, Empty, IconButton, Segmented, Skeleton, StatusIcon } from '../components/ui'
import { matches, timeAgo, useNow } from '../lib/format'
import { api, toast, updateSettings, useSettings, useSnapshot } from '../lib/store'
import { openInApp } from '../lib/open'
import type { WidgetProps } from './types'

type Tab = keyof Inbox | 'approvals' | 'notifications'

/** Cross-repo "what needs me" list, backed by GitHub search, so it isn't limited to tracked repos. */
export const InboxWidget = memo(function InboxWidget({ widget, filter }: WidgetProps) {
  const snapshot = useSnapshot()
  const settings = useSettings()
  const now = useNow()
  const tab = (widget.options.tab as Tab) || 'reviewRequests'
  const inbox = snapshot.inbox
  const setTab = (t: Tab) =>
    void updateSettings({
      widgets: settings.widgets.map((w) => (w.id === widget.id ? { ...w, options: { ...w.options, tab: t } } : w))
    })

  const approvals = (snapshot.approvals ?? []).filter(canApprove)
  const notifications = snapshot.notifications ?? []
  const unread = notifications.filter((n) => n.unread).length
  const items =
    tab === 'approvals' || tab === 'notifications' ? [] : (inbox?.[tab] ?? []).filter((i) => !filter || matches(`${i.repo} #${i.number} ${i.title} ${i.author}`, filter))

  return (
    <div className="inbox">
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          ['reviewRequests', `Reviews ${inbox?.reviewRequests.length ?? ''}`],
          ['myPrs', `My PRs ${inbox?.myPrs.length ?? ''}`],
          ['assigned', `Issues ${inbox?.assigned.length ?? ''}`],
          ['approvals', `Approvals ${approvals.length || ''}`],
          ['notifications', `Notifications ${unread || ''}`]
        ]}
      />
      {tab === 'approvals' ? (
        <Approvals items={approvals.filter((a) => !filter || matches(`${a.repo} ${a.runName} ${environmentNames(a)} ${a.actor}`, filter))} />
      ) : tab === 'notifications' ? (
        <Notifications filter={filter} />
      ) : !inbox ? (
        <Skeleton />
      ) : !items.length ? (
        <Empty>{tab === 'reviewRequests' ? 'No reviews waiting on you. 🎉' : 'Nothing here.'}</Empty>
      ) : (
        <ul className="list">
          {items.map((i) => (
            <li key={i.url} className="row clickable" onClick={() => openInApp(i.url)}>
              {i.kind === 'pr' ? <StatusIcon tone={checksTone(i.checks ?? null)} /> : <StatusIcon tone="warn" title="Issue" />}
              <div className="row-main">
                <div className="row-title">
                  {i.isDraft && <span className="badge badge-muted">Draft</span>}
                  <span className="strong">{i.title}</span>
                </div>
                <div className="row-meta">
                  <span className="chip">{i.repo}</span>
                  <span>#{i.number}</span>
                  <Avatar src={i.authorAvatar} login={i.author} size={14} />
                  <span>{i.author}</span>
                  {i.reviewDecision === 'APPROVED' && <span className="add">approved</span>}
                  {i.reviewDecision === 'CHANGES_REQUESTED' && <span className="del">changes requested</span>}
                </div>
              </div>
              <div className="row-side">
                <span className="dim small">{timeAgo(i.updatedAt, now)}</span>
              </div>
              <div className="row-actions">
                <IconButton icon="external" title="Open in browser" onClick={() => void api.openExternal(i.url)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

function Approvals({ items }: { items: NonNullable<ReturnType<typeof useSnapshot>['approvals']> }) {
  const snapshot = useSnapshot()
  const now = useNow()
  if (!items.length) return <Empty>No deployments waiting for you.</Empty>
  const open = (runId: number, repo: string, url: string) => {
    // The run view has the Approve / Reject buttons; fall back to the browser for a run we no longer hold.
    if (snapshot.repos[repo]?.runs.some((r) => r.id === runId)) openInApp(url)
    else void api.openExternal(url)
  }
  return (
    <ul className="list">
      {items.map((a) => (
        <li key={a.runId} className="row clickable" onClick={() => open(a.runId, a.repo, a.runUrl)}>
          <StatusIcon tone="warn" title="Waiting for approval" />
          <div className="row-main">
            <div className="row-title">
              <span className="strong">
                {a.runName} → {environmentNames(a)}
              </span>
            </div>
            <div className="row-meta">
              <span className="chip">{a.repo}</span>
              <span className="mono">{a.branch}</span>
              <span>#{a.runNumber}</span>
              <span>by {a.actor}</span>
            </div>
          </div>
          <div className="row-side">
            <span className="dim small">{timeAgo(a.since, now)}</span>
          </div>
          <div className="row-actions">
            <IconButton icon="external" title="Open in browser" onClick={() => void api.openExternal(a.runUrl)} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** GitHub's own notifications: mentions, discussions, releases and more that the searches above don't cover. */
function Notifications({ filter }: { filter: string }) {
  const snapshot = useSnapshot()
  const now = useNow()
  const list = (snapshot.notifications ?? []).filter((n) => !filter || matches(`${n.repo} ${n.title} ${n.reason} ${n.type}`, filter))
  if (snapshot.notificationsError && !snapshot.notifications) return <Empty>{snapshot.notificationsError}</Empty>
  if (!snapshot.notifications) return <Skeleton />
  const read = async (id?: string) => {
    const r = await api.readNotifications(id)
    if (!r.ok) toast(`Couldn't mark as read: ${r.error}`, 'error')
  }
  return (
    <>
      {list.some((n) => n.unread) && (
        <div className="inline">
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => void read()}>
            Mark all as read
          </button>
        </div>
      )}
      {!list.length ? (
        <Empty>You're all caught up.</Empty>
      ) : (
        <ul className="list">
          {list.map((n) => (
            <li
              key={n.id}
              className={`row clickable${n.unread ? ' unread' : ''}`}
              onClick={() => {
                if (n.unread) void read(n.id)
                openInApp(n.url)
              }}
            >
              <StatusIcon tone={n.unread ? 'run' : 'muted'} title={n.unread ? 'Unread' : 'Read'} />
              <div className="row-main">
                <div className="row-title">
                  <span className={n.unread ? 'strong' : undefined}>{n.title}</span>
                </div>
                <div className="row-meta">
                  <span className="chip">{n.repo}</span>
                  <span>{n.type.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>
                  <span>{reasonLabel(n.reason)}</span>
                </div>
              </div>
              <div className="row-side">
                <span className="dim small">{timeAgo(n.updatedAt, now)}</span>
              </div>
              <div className="row-actions">
                {n.unread && <IconButton icon="check" title="Mark as read" onClick={() => void read(n.id)} />}
                <IconButton icon="external" title="Open in browser" onClick={() => void api.openExternal(n.url)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
