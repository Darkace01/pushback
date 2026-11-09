import { useEffect, useState } from 'react'
import type { MergeStatus as Status } from '../../../shared/mergeStatus'
import { api } from '../lib/store'
import { pushModal } from '../lib/ui'
import { StatusIcon } from './ui'

const QUEUE_STATE: Record<string, string> = {
  QUEUED: 'queued',
  AWAITING_CHECKS: 'waiting for checks',
  MERGEABLE: 'ready to merge',
  UNMERGEABLE: 'cannot merge',
  LOCKED: 'locked'
}

const eta = (s: number | null) => (s ? `, about ${s < 90 ? `${s}s` : `${Math.round(s / 60)} min`} to merge` : '')

/** What blocks this PR from merging: required checks, reviews, conflicts, and its place in the merge queue. */
export function MergeStatus({ repo, number, refreshKey }: { repo: string; number: number; refreshKey?: string }) {
  const [status, setStatus] = useState<Status>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let alive = true
    api.prMergeStatus(repo, number).then(
      (s) => alive && (setStatus(s), setError(undefined)),
      (e: Error) => alive && setError(e.message)
    )
    return () => {
      alive = false
    }
  }, [repo, number, refreshKey])

  if (error) return <p className="dim small merge-status">Merge status unavailable: {error}</p>
  if (!status) return null
  const required = status.checks.filter((c) => c.required)
  const clear = !status.blockers.length

  return (
    <section className={`merge-status ${clear ? 'clear' : 'blocked'}`} aria-label="Merge status">
      <div className="merge-head">
        <StatusIcon tone={clear ? 'ok' : 'bad'} />
        <strong>{status.queue ? `In the merge queue for ${status.base}` : clear ? 'Ready to merge' : 'Merging is blocked'}</strong>
        {status.queue && (
          <span className="dim">
            position {status.queue.position}, {QUEUE_STATE[status.queue.state] ?? status.queue.state.toLowerCase()}
            {eta(status.queue.etaSeconds)}
          </span>
        )}
        {status.queue && (
          <button className="link" onClick={() => pushModal({ kind: 'merge-queue', repo, branch: status.base || undefined })}>
            View the whole queue
          </button>
        )}
        {status.autoMerge && <span className="badge badge-muted">Auto-merge on{status.autoMerge.by ? ` (${status.autoMerge.by})` : ''}</span>}
      </div>
      {status.blockers.length > 0 && (
        <ul className="merge-blockers">
          {status.blockers.map((b, i) => (
            <li key={i} className={`blocker blocker-${b.kind}`}>
              {b.text}
            </li>
          ))}
        </ul>
      )}
      {(required.length > 0 || status.approvals.need > 0) && (
        <div className="dim small merge-facts">
          {status.approvals.need > 0 && (
            <span>
              Approvals {status.approvals.have}/{status.approvals.need}
            </span>
          )}
          {required.length > 0 && (
            <span>
              Required checks {required.filter((c) => c.state === 'pass').length}/{required.length} passing
            </span>
          )}
        </div>
      )}
    </section>
  )
}
