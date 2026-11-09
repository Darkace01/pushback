import { RepoRail } from './RepoRail'
import { RunDeployments } from './Deployments'
import { JobTimeline, RunApprovals, RunArtifacts, RunTiming } from './RunExtras'
import { WatchButton } from './Watch'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Job, PullRequest, ReviewEvent, Workflow, WorkflowRun } from '../../../shared/types'
import { duration, timeAgo, useNow } from '../lib/format'
import { api, toast, useSnapshot } from '../lib/store'
import { closeModal, pushModal } from '../lib/ui'
import { cancel, rerun } from '../widgets/RunsWidget'
import { Avatar, Modal, runTone, Segmented, Skeleton, StatusIcon } from './ui'

export function DispatchModal({ workflow }: { workflow: Workflow }) {
  const snapshot = useSnapshot()
  const repo = snapshot.repos[workflow.repo]
  const [ref, setRef] = useState(repo?.defaultBranch ?? 'main')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(workflow.inputs.map((i) => [i.name, i.default ?? (i.type === 'boolean' ? 'false' : i.options?.[0] ?? '')]))
  )
  const [busy, setBusy] = useState(false)
  const branches = useMemo(
    () => [...new Set([repo?.defaultBranch, ...(repo?.prs.map((p) => p.branch) ?? []), ...(repo?.runs.map((r) => r.branch) ?? [])].filter(Boolean))] as string[],
    [repo]
  )
  const missing = workflow.inputs.filter((i) => i.required && !values[i.name]?.trim())

  const submit = async () => {
    setBusy(true)
    const r = await api.dispatch(workflow.repo, workflow.id, ref.trim(), values)
    setBusy(false)
    if (r.ok) {
      toast(`Started ${workflow.name} on ${ref}`, 'ok')
      closeModal()
      // Go straight to the run that was just queued, so you can watch its jobs and logs.
      if (r.run) pushModal({ kind: 'run', run: r.run })
    } else toast(`Couldn't start workflow: ${r.error}`, 'error')
  }

  return (
    <Modal title={`Run “${workflow.name}”`} onClose={closeModal} width={500}>
      <p className="dim small">
        {workflow.repo} · <span className="mono">{workflow.path}</span>
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (!missing.length) void submit()
        }}
      >
        <label className="field">
          <span>Branch or tag</span>
          <input list="dispatch-refs" value={ref} onChange={(e) => setRef(e.target.value)} autoFocus />
          <datalist id="dispatch-refs">
            {branches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        {workflow.inputs.map((input) => {
          const value = values[input.name] ?? ''
          const set = (v: string) => setValues({ ...values, [input.name]: v })
          const label = (
            <>
              {input.name}
              {input.required && <span className="del"> *</span>}
            </>
          )
          if (input.type === 'boolean')
            return (
              <label key={input.name} className="check">
                <input type="checkbox" checked={value === 'true'} onChange={(e) => set(String(e.target.checked))} />
                <span>
                  <span className="strong">{label}</span> {input.description && <span className="dim">— {input.description}</span>}
                </span>
              </label>
            )
          return (
            <label key={input.name} className="field">
              <span>{label}</span>
              {input.type === 'choice' && input.options ? (
                <select value={value} onChange={(e) => set(e.target.value)}>
                  {input.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input type={input.type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => set(e.target.value)} />
              )}
              {input.description && <small>{input.description}</small>}
            </label>
          )
        })}
        <footer className="modal-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeModal}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !ref.trim() || missing.length > 0}>
            {busy ? 'Starting…' : '▶ Run workflow'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function JobView({ job, repo, initiallyOpen }: { job: Job; repo: string; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const [log, setLog] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const now = useNow(5000)
  const tone = runTone({ status: job.status as WorkflowRun['status'], conclusion: job.conclusion })

  const loadLog = async () => {
    setLoading(true)
    try {
      setLog(await api.jobLog(repo, job.id))
    } catch (err) {
      setLog(`Couldn't load log: ${(err as Error).message}`)
    }
    setLoading(false)
  }

  // Failures are near the end of a log, so land on the first error line (or the bottom), not the setup noise.
  useEffect(() => {
    const pre = logRef.current
    if (!pre || log === null) return
    // Prefer GitHub's own ##[error] annotations over lines that merely mention "error".
    const loose = pre.querySelectorAll<HTMLElement>('.err')
    const err = pre.querySelector<HTMLElement>('.err.annotated') ?? loose[loose.length - 1]
    pre.scrollTop = err ? err.offsetTop - pre.clientHeight / 3 : pre.scrollHeight
  }, [log])

  return (
    <div className="job">
      <div className="job-head" onClick={() => setOpen(!open)}>
        <StatusIcon tone={tone} />
        <span className="strong">{job.name}</span>
        <span className="dim small">{job.startedAt ? duration(job.startedAt, job.completedAt ?? now) : 'queued'}</span>
        {job.status === 'completed' && (
          <button
            className="btn btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(true)
              void loadLog()
            }}
          >
            {loading ? 'Loading…' : 'Log'}
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            void api.openExternal(job.url)
          }}
        >
          Open
        </button>
      </div>
      {open && (
        <ul className="steps">
          {job.steps.map((s) => (
            <li key={s.number}>
              <StatusIcon tone={runTone({ status: s.status as WorkflowRun['status'], conclusion: s.conclusion })} size={13} />
              <span>{s.name}</span>
              <span className="dim">{s.startedAt ? duration(s.startedAt, s.completedAt ?? now) : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {open && log !== null && (
        <pre className="log" ref={logRef}>
          {log.split('\n').map((raw, i) => {
            // Drop the timestamp prefix and ANSI colour codes.
            const line = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, '').replace(/\x1b\[[0-9;]*m/g, '')
            if (line.startsWith('##[endgroup]')) return null
            if (line.startsWith('##[group]')) return <div key={i} className="log-group">▸ {line.slice(9)}</div>
            const annotated = line.startsWith('##[error]')
            const isError = annotated || /\berror\b|FAILED|Error:/i.test(line)
            return (
              <div key={i} className={isError ? `err${annotated ? ' annotated' : ''}` : undefined}>
                {line.replace(/^##\[(error|warning|notice|debug)\]/, (_, kind: string) => `${kind}: `)}
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}

export function RunDetailsModal({ run: initial }: { run: WorkflowRun }) {
  const snapshot = useSnapshot()
  const run = snapshot.repos[initial.repo]?.runs.find((r) => r.id === initial.id) ?? initial
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [error, setError] = useState<string>()
  const [view, setView] = useState<'steps' | 'timeline'>('steps')
  const active = run.status !== 'completed'
  const now = useNow(5000)

  useEffect(() => {
    let alive = true
    const load = () =>
      api.runJobs(run.repo, run.id).then(
        (j) => alive && setJobs(j),
        (e: Error) => alive && setError(e.message)
      )
    void load()
    // Jobs aren't part of the regular poll, so refresh them while the run is live.
    const t = active ? setInterval(load, 5000) : undefined
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [run.repo, run.id, active, run.attempt])

  const tone = runTone(run)
  const workflow = snapshot.repos[run.repo]?.workflows.find((w) => w.id === run.workflowId)
  return (
    <Modal title={`${run.name} #${run.runNumber}`} onClose={closeModal} width={760} side={<RepoRail repo={run.repo} />}>
      <div className="account">
        <StatusIcon tone={tone} size={22} />
        <div>
          <div className="strong">{run.title}</div>
          <div className="row-meta">
            <span>{run.repo}</span>
            <span className="mono">{run.branch}</span>
            <span className="mono">{run.sha.slice(0, 7)}</span>
            <span>{run.event}</span>
            <Avatar src={run.actorAvatar} login={run.actor} size={14} />
            <span>{run.actor}</span>
            <span>{timeAgo(run.createdAt, now)}</span>
            <span>{active ? duration(run.startedAt, now) : duration(run.startedAt, run.updatedAt)}</span>
            <RunTiming run={run} />
          </div>
        </div>
      </div>
      <div className="inline">
        {active && (
          <button className="btn" onClick={() => void cancel(run)}>
            Cancel run
          </button>
        )}
        {!active && tone === 'bad' && (
          <button className="btn btn-primary" onClick={() => void rerun(run, true)}>
            Re-run failed jobs
          </button>
        )}
        {!active && (
          <button className="btn" onClick={() => void rerun(run, false)}>
            Re-run all jobs
          </button>
        )}
        <WatchButton run={run} />
        <span className="spacer" />
        {workflow?.path.startsWith('.github/workflows/') && (
          <button className="btn" onClick={() => pushModal({ kind: 'workflow-file', repo: run.repo, path: workflow.path, ref: run.sha, name: workflow.name })}>
            View workflow file
          </button>
        )}
        <button className="btn" onClick={() => void navigator.clipboard.writeText(run.url).then(() => toast('Link copied', 'ok'))}>
          Copy link
        </button>
        <button className="btn" onClick={() => void api.openExternal(run.url)}>
          Open on GitHub
        </button>
      </div>
      <RunApprovals run={run} />
      <RunDeployments repo={run.repo} runId={run.id} />
      {error && <p className="del">{error}</p>}
      {!jobs && !error && <Skeleton rows={3} />}
      {jobs && jobs.length > 1 && (
        <Segmented
          value={view}
          onChange={setView}
          options={[
            ['steps', 'Jobs and steps'],
            ['timeline', 'Timeline']
          ]}
        />
      )}
      {jobs && view === 'timeline' && jobs.length > 1 && <JobTimeline jobs={jobs} />}
      {jobs && (view === 'steps' || jobs.length <= 1) && (
        <div className="jobs">
          {jobs.map((job) => (
            <JobView key={job.id} job={job} repo={run.repo} initiallyOpen={job.conclusion === 'failure' || job.status === 'in_progress'} />
          ))}
          {!jobs.length && <p className="dim">No jobs.</p>}
        </div>
      )}
      <RunArtifacts run={run} />
    </Modal>
  )
}

export function MergeModal({ pr }: { pr: Pick<PullRequest, 'repo' | 'number' | 'title' | 'url'> }) {
  const [method, setMethod] = useState<'squash' | 'merge' | 'rebase'>('squash')
  const [auto, setAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const merge = async () => {
    setBusy(true)
    const r = auto ? await api.autoMergePr(pr.repo, pr.number, method, true) : await api.mergePr(pr.repo, pr.number, method)
    setBusy(false)
    if (r.ok) {
      toast(auto ? `Auto-merge on for ${pr.repo}#${pr.number}` : `Merged ${pr.repo}#${pr.number}`, 'ok')
      closeModal()
    } else toast(`${auto ? 'Auto-merge' : 'Merge'} failed: ${r.error}`, 'error')
  }
  return (
    <Modal title={`Merge #${pr.number}`} onClose={closeModal} width={460}>
      <p>
        <span className="strong">{pr.title}</span>
        <br />
        <span className="dim">{pr.repo}</span>
      </p>
      <Segmented
        value={method}
        onChange={setMethod}
        options={[
          ['squash', 'Squash and merge'],
          ['merge', 'Merge commit'],
          ['rebase', 'Rebase and merge']
        ]}
      />
      <label className="check">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Merge automatically once checks and reviews pass
      </label>
      <p className="dim small">
        {auto
          ? "GitHub merges it for you when every requirement is met. The repository must have auto-merge enabled in its settings."
          : 'Branch protection rules still apply — GitHub will refuse the merge if required checks or reviews are missing.'}
      </p>
      <footer className="modal-actions">
        <button className="link" onClick={() => void api.openExternal(pr.url)}>
          Review on GitHub first →
        </button>
        <span className="spacer" />
        <button className="btn" onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void merge()}>
          {busy ? 'Working…' : auto ? 'Enable auto-merge' : 'Confirm merge'}
        </button>
      </footer>
    </Modal>
  )
}

const REVIEW_CHOICES: [ReviewEvent, string][] = [
  ['COMMENT', 'Comment'],
  ['APPROVE', 'Approve'],
  ['REQUEST_CHANGES', 'Request changes']
]

export function ReviewModal({ pr }: { pr: Pick<PullRequest, 'repo' | 'number' | 'title' | 'url'> }) {
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const needsBody = event !== 'APPROVE'
  const submit = async () => {
    setBusy(true)
    const r = await api.reviewPr(pr.repo, pr.number, event, body)
    setBusy(false)
    if (r.ok) {
      toast(`Review sent on ${pr.repo}#${pr.number}`, 'ok')
      closeModal()
    } else toast(`Review failed: ${r.error}`, 'error')
  }
  return (
    <Modal title={`Review #${pr.number}`} onClose={closeModal} width={520}>
      <p>
        <span className="strong">{pr.title}</span>
        <br />
        <span className="dim">{pr.repo}</span>
      </p>
      <Segmented value={event} onChange={setEvent} options={REVIEW_CHOICES} />
      <textarea
        className="input"
        rows={6}
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={needsBody ? (event === 'COMMENT' ? 'Leave a comment' : 'What needs to change?') : 'Optional note with your approval'}
      />
      <p className="dim small">To comment on specific lines, open the pull request's Files tab and click a line number.</p>
      <footer className="modal-actions">
        <button className="link" onClick={() => void api.openExternal(pr.url)}>
          Review on GitHub →
        </button>
        <span className="spacer" />
        <button className="btn" onClick={closeModal}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy || (needsBody && !body.trim())} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Submit review'}
        </button>
      </footer>
    </Modal>
  )
}
