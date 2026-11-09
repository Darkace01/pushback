import type { WorkflowRun } from '../../../shared/types'
import { elapsed, outcome } from '../../../shared/watch'
import { useNow } from '../lib/format'
import { api } from '../lib/store'
import { useApplyAppearance } from '../lib/theme'
import { isWatched, toggleWatch, useWatched } from '../lib/watch'
import { IconButton, runTone, StatusIcon } from './ui'

/** "Watch" on the run view: pins the run to the mini window and notifies when it finishes. */
export function WatchButton({ run }: { run: WorkflowRun }) {
  const on = isWatched(useWatched(), run)
  return (
    <button
      className={`btn${on ? ' active' : ''}`}
      aria-pressed={on}
      title={on ? 'Stop watching this run' : 'Show this run in a small always-on-top window and notify when it finishes'}
      onClick={() => void toggleWatch(run, !on)}
    >
      {on ? 'Watching' : 'Watch'}
    </button>
  )
}

/** The same, as an icon in a run row. */
export function WatchIconButton({ run }: { run: WorkflowRun }) {
  const on = isWatched(useWatched(), run)
  return <IconButton icon="eye" title={on ? 'Stop watching' : 'Watch this run'} active={on} onClick={() => void toggleWatch(run, !on)} />
}

/** The whole page of the mini window (index.html#mini): every watched run, its current step and elapsed time. */
export function MiniWatch() {
  useApplyAppearance()
  const runs = useWatched()
  const now = useNow(1000)
  return (
    <div className="mini">
      <header className="mini-head">
        <span className="strong">Watching {runs.length} run{runs.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <IconButton icon="close" title="Stop watching and close" onClick={() => void api.unwatchRun()} />
      </header>
      <ul className="mini-list">
        {runs.map(({ run, job, step, error }) => {
          const done = run.status === 'completed'
          return (
            <li key={`${run.repo}#${run.id}`} className={`mini-run${done ? ` mini-done mini-${runTone(run)}` : ''}`}>
              <StatusIcon tone={runTone(run)} title={outcome(run)} />
              <button className="mini-main" title="Open in Pushback" onClick={() => void api.showWatched(run.repo, run.id)}>
                <span className="mini-title">
                  <span className="strong">{run.name}</span> <span className="dim">#{run.runNumber}</span>
                </span>
                <span className="mini-meta dim">
                  {run.repo} · {run.branch}
                </span>
                <span className="mini-meta">
                  {done ? (
                    <span className="strong">{outcome(run)[0].toUpperCase() + outcome(run).slice(1)}</span>
                  ) : job ? (
                    <>
                      {job}
                      {step && <span className="dim"> › {step}</span>}
                    </>
                  ) : (
                    <span className="dim">{run.status === 'in_progress' ? 'Running…' : 'Waiting to start…'}</span>
                  )}
                  {error && <span className="del" title={error}> ⚠</span>}
                </span>
              </button>
              <span className={done ? 'dim small' : 'live small'}>{elapsed(run.startedAt, done ? Date.parse(run.updatedAt) : now)}</span>
              <IconButton icon="close" title="Stop watching" onClick={() => void api.unwatchRun(run.repo, run.id)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
