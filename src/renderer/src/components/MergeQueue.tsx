import { useEffect, useState } from 'react'
import { formatEta, QUEUE_STATE_LABEL, type MergeQueueEntry, type QueueEntryState } from '../../../shared/mergeQueue'
import { timeAgo, useNow } from '../lib/format'
import { webUrl } from '../lib/hosts'
import { openPr } from '../lib/open'
import { api } from '../lib/store'
import { closeModal } from '../lib/ui'
import { useLoad } from '../lib/useLoad'
import type { SectionProps } from './RepoWorkspace'
import { RepoRail } from './RepoRail'
import { Avatar, Empty, Modal, Skeleton, StatusIcon } from './ui'

const TONE: Record<QueueEntryState, 'ok' | 'bad' | 'warn' | 'muted' | 'run'> = {
  queued: 'muted',
  'awaiting-checks': 'run',
  mergeable: 'ok',
  unmergeable: 'bad',
  locked: 'warn',
  unknown: 'muted'
}
const BADGE: Record<QueueEntryState, string> = {
  queued: 'badge-muted',
  'awaiting-checks': 'badge-warn',
  mergeable: 'badge-ok',
  unmergeable: 'badge-bad',
  locked: 'badge-warn',
  unknown: 'badge-muted'
}
const METHOD: Record<string, string> = { MERGE: 'merge commit', SQUASH: 'squash', REBASE: 'rebase' }
const STRATEGY: Record<string, string> = { ALLGREEN: 'every entry must pass', HEADGREEN: 'only the group head must pass' }

// The queue moves while you watch it, so refresh it while the view is open; it is never polled otherwise.
const REFRESH_MS = 60_000

function Entry({ repo, entry, now }: { repo: string; entry: MergeQueueEntry; now: number }) {
  const eta = formatEta(entry.etaSeconds)
  return (
    <li className="row clickable queue-entry" onClick={() => openPr(repo, entry.number)}>
      <span className="queue-pos" title={`Position ${entry.position}`}>
        {entry.position}
      </span>
      <StatusIcon tone={TONE[entry.state]} title={QUEUE_STATE_LABEL[entry.state]} />
      <div className="row-main">
        <div className="row-title">
          <span className="strong">{entry.title}</span> <span className="dim">#{entry.number}</span>
        </div>
        <div className="row-meta">
          <span className={`badge ${BADGE[entry.state]}`}>{QUEUE_STATE_LABEL[entry.state]}</span>
          <Avatar src={entry.authorAvatar} login={entry.author} size={14} />
          <span>{entry.author}</span>
          <span title={new Date(entry.enqueuedAt).toLocaleString()}>
            queued {timeAgo(entry.enqueuedAt, now)}
            {entry.enqueuedBy && entry.enqueuedBy !== entry.author ? ` by ${entry.enqueuedBy}` : ''}
          </span>
          {eta && <span>{eta} to merge</span>}
          {entry.jump && <span className="chip">jumped the queue</span>}
          {entry.solo && <span className="chip">merges alone</span>}
        </div>
      </div>
    </li>
  )
}

/** Every PR in a branch's merge queue, in order. `branch` defaults to the repo's default branch. */
export function MergeQueueView({ repo, branch }: { repo: string; branch?: string }) {
  const now = useNow()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(t)
  }, [])
  const { data: queue, error, loading } = useLoad(repo, () => api.mergeQueue(repo, branch), [branch, tick])
  const name = queue?.branch || branch || 'the default branch'
  const url = queue?.url ?? webUrl(repo, branch ? `/queue/${branch}` : '/queue')

  return (
    <div className="merge-queue">
      <div className="ws-toolbar queue-head">
        <h3>
          Merge queue for <span className="mono">{name}</span>
        </h3>
        {queue?.enabled && (
          <span className="dim small">
            {queue.total} {queue.total === 1 ? 'entry' : 'entries'}
            {queue.mergeMethod ? ` · ${METHOD[queue.mergeMethod] ?? queue.mergeMethod.toLowerCase()}` : ''}
            {queue.strategy ? ` · ${STRATEGY[queue.strategy] ?? queue.strategy.toLowerCase()}` : ''}
            {queue.maxBuilding ? ` · builds up to ${queue.maxBuilding} at once` : ''}
          </span>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" disabled={loading} onClick={() => setTick((n) => n + 1)}>
          Refresh
        </button>
        <button className="btn btn-sm" onClick={() => void api.openExternal(url)}>
          Open in browser
        </button>
      </div>
      {error && <p className="del">Couldn't load the merge queue: {error}</p>}
      {!queue && !error && <Skeleton rows={3} />}
      {queue && !queue.enabled && (
        <Empty>
          {repo} doesn't use a merge queue on {name}. A branch ruleset or protection rule has to require one before PRs can be queued.
        </Empty>
      )}
      {queue?.enabled && !queue.entries.length && <Empty>The merge queue for {name} is empty.</Empty>}
      {queue?.enabled && queue.entries.length > 0 && (
        <ul className="list repo-tab">
          {queue.entries.map((e) => (
            <Entry key={e.number} repo={repo} entry={e} now={now} />
          ))}
        </ul>
      )}
      {queue && queue.total > queue.entries.length && <p className="dim small">Showing the first {queue.entries.length} of {queue.total}.</p>}
    </div>
  )
}

/** The repo tab section: the default branch's queue. */
export function MergeQueueSection({ repo, info }: SectionProps) {
  return <MergeQueueView repo={repo} branch={info?.defaultBranch} />
}

/** The queue as a page, opened from a PR's merge-status panel. */
export function MergeQueueModal({ repo, branch }: { repo: string; branch?: string }) {
  return (
    <Modal title={`${repo} merge queue`} onClose={closeModal} panel side={<RepoRail repo={repo} />}>
      <MergeQueueView repo={repo} branch={branch} />
    </Modal>
  )
}
