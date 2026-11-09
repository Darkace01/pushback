import { useEffect, useState } from 'react'
import type { Job, PendingApproval, RunArtifact, WorkflowRun } from '../../../shared/types'
import { canApprove, environmentNames } from '../../../shared/approvals'
import { compareToTypical, jobTimeline, runSeconds, typicalSeconds } from '../../../shared/timeline'
import { timeAgo, useNow } from '../lib/format'
import { api, toast, useSnapshot } from '../lib/store'
import { runTone, StatusIcon } from './ui'

/** 75 → "1m 15s" */
export function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** A run paused for a protected environment: who must approve, and Approve / Reject for the environments you can. */
export function RunApprovals({ run }: { run: WorkflowRun }) {
  const snapshot = useSnapshot()
  const polled = snapshot.approvals?.find((a) => a.runId === run.id)
  const [fetched, setFetched] = useState<PendingApproval | null>()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const waiting = run.status === 'waiting'

  useEffect(() => {
    if (!waiting || polled) return
    let alive = true
    api.pendingDeployments(run.repo, run.id).then(
      (a) => alive && setFetched(a),
      () => alive && setFetched(null)
    )
    return () => void (alive = false)
  }, [waiting, polled, run.repo, run.id])

  const approval = polled ?? fetched
  if (!waiting || !approval) return null
  const mine = approval.environments.filter((e) => e.canApprove)

  const review = async (state: 'approved' | 'rejected') => {
    setBusy(true)
    const r = await api.reviewDeployments(run.repo, run.id, mine.map((e) => e.id), state, comment)
    setBusy(false)
    if (!r.ok) return toast(`Couldn't ${state === 'approved' ? 'approve' : 'reject'}: ${r.error}`, 'error')
    toast(`${state === 'approved' ? 'Approved' : 'Rejected'} ${mine.map((e) => e.name).join(', ')}`, 'ok')
    setComment('')
  }

  return (
    <section className="approval" aria-label="Waiting for approval">
      <div className="approval-head">
        <StatusIcon tone="warn" />
        <span className="strong">Waiting for approval to deploy to {environmentNames(approval)}</span>
      </div>
      <ul className="approval-envs">
        {approval.environments.map((e) => (
          <li key={e.id}>
            <span className="chip mono">{e.name}</span>
            <span className="dim small">
              {e.reviewers.length ? `Reviewers: ${e.reviewers.join(', ')}` : 'Any reviewer'}
              {e.waitTimer > 0 && ` · waits ${e.waitTimer} min after approval`}
            </span>
            {e.canApprove && <span className="badge">You can approve</span>}
          </li>
        ))}
      </ul>
      {canApprove(approval) ? (
        <div className="approval-actions">
          <input className="input" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Approval comment" />
          <button className="btn" disabled={busy} onClick={() => void review('rejected')}>
            Reject
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void review('approved')}>
            {busy ? 'Sending…' : 'Approve and deploy'}
          </button>
        </div>
      ) : (
        <p className="dim small">You aren't a required reviewer for these environments.</p>
      )}
    </section>
  )
}

/** The files a run uploaded, with a download for each that hasn't expired. Loaded once the run has finished. */
export function RunArtifacts({ run }: { run: WorkflowRun }) {
  const [artifacts, setArtifacts] = useState<RunArtifact[]>()
  const [busy, setBusy] = useState<number>()
  const now = useNow()
  const done = run.status === 'completed'

  useEffect(() => {
    if (!done) return
    let alive = true
    api.runArtifacts(run.repo, run.id).then(
      (a) => alive && setArtifacts(a),
      () => alive && setArtifacts([])
    )
    return () => void (alive = false)
  }, [done, run.repo, run.id, run.attempt])

  if (!artifacts?.length) return null

  const download = async (a: RunArtifact) => {
    setBusy(a.id)
    const r = await api.downloadArtifact(run.repo, a.id, a.name)
    setBusy(undefined)
    if (r.ok) toast(`Saved ${a.name}`, 'ok')
    else if (r.error) toast(`Download failed: ${r.error}`, 'error')
  }

  return (
    <section className="artifacts" aria-label="Artifacts">
      <h3 className="section-title">Artifacts {artifacts.length}</h3>
      <ul className="list">
        {artifacts.map((a) => (
          <li key={a.id} className="row">
            <div className="row-main">
              <div className="row-title">
                <span className="strong mono">{a.name}</span>
              </div>
              <div className="row-meta">
                <span>{formatBytes(a.size)}</span>
                {a.expired ? <span className="del">Expired</span> : a.expiresAt && <span>expires {timeAgo(a.expiresAt, now).replace(' ago', '')}</span>}
              </div>
            </div>
            <button className="btn btn-sm" disabled={a.expired || busy === a.id} onClick={() => void download(a)}>
              {busy === a.id ? 'Downloading…' : 'Download'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "Took 4m 12s · 12% slower than usual", against the median of this workflow's recent successful runs. */
export function RunTiming({ run }: { run: WorkflowRun }) {
  const snapshot = useSnapshot()
  if (run.status !== 'completed') return null
  const typical = typicalSeconds(snapshot.repos[run.repo]?.runs ?? [], run.workflowId, run.id)
  const verdict = compareToTypical(runSeconds(run), typical)
  if (!verdict || !typical) return null
  return (
    <span className="dim small" title={`This workflow usually takes ${formatSeconds(typical)}`}>
      {verdict} (usually {formatSeconds(typical)})
    </span>
  )
}

/** Every job on one time axis, so what ran in parallel and what held the run up are obvious. */
export function JobTimeline({ jobs }: { jobs: Job[] }) {
  const now = useNow(5000)
  const t = jobTimeline(jobs, now)
  if (!t.bars.length) return <p className="dim">No job has started yet.</p>
  return (
    <div className="timeline-chart" role="list" aria-label="Job timeline">
      <div className="timeline-total dim small">Total {formatSeconds(t.seconds)}</div>
      {t.bars.map((b) => {
        const tone = runTone({ status: b.status as WorkflowRun['status'], conclusion: b.conclusion })
        return (
          <div key={b.id} className="timeline-row" role="listitem">
            <span className="timeline-name" title={b.name}>
              {b.name}
            </span>
            <div className="timeline-track">
              <div className={`timeline-bar tone-${tone}${b.running ? ' running' : ''}`} style={{ left: `${b.left}%`, width: `${b.width}%` }} title={`${b.name}: ${formatSeconds(b.seconds)}`} />
            </div>
            <span className="timeline-time dim small">{formatSeconds(b.seconds)}</span>
          </div>
        )
      })}
      {t.queued.length > 0 && <p className="dim small">Not started: {t.queued.map((q) => q.name).join(', ')}</p>}
    </div>
  )
}
