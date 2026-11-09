import { memo, useMemo } from 'react'
import type { WorkflowRun } from '../../../shared/types'
import { Avatar, Empty, IconButton, runTone, StatusIcon } from '../components/ui'
import { useDeployments } from '../lib/deployments'
import { duration, matches, shortRepo, timeAgo, useNow } from '../lib/format'
import { api, toast, useSettings, useSnapshot, widgetRepos } from '../lib/store'
import { pushModal } from '../lib/ui'
import type { WidgetProps } from './types'
import { WatchIconButton } from '../components/Watch'

export async function rerun(run: WorkflowRun, failedOnly: boolean): Promise<void> {
  const r = await api.rerun(run.repo, run.id, failedOnly)
  toast(r.ok ? `Re-running ${run.name} #${run.runNumber}` : `Re-run failed: ${r.error}`, r.ok ? 'ok' : 'error')
}

export async function cancel(run: WorkflowRun): Promise<void> {
  const r = await api.cancel(run.repo, run.id)
  toast(r.ok ? `Cancelling ${run.name} #${run.runNumber}` : `Cancel failed: ${r.error}`, r.ok ? 'ok' : 'error')
}

const EMPTY: Record<string, string> = {
  active: 'Nothing running right now.',
  failed: 'No failed runs. 🎉',
  mine: "You haven't triggered any runs recently."
}

export const RunsWidget = memo(function RunsWidget({ widget, filter }: WidgetProps) {
  const snapshot = useSnapshot()
  const settings = useSettings()
  const now = useNow(10_000)
  const repos = widgetRepos(widget.repos, settings.repos)
  const { filter: mode = 'all', branch = '', limit = 30, latestOnly = false, workflow = '', event = '', actor = '' } = widget.options
  const viewer = snapshot.viewer?.login

  const runs = useMemo(() => {
    let all = repos.flatMap((r) => snapshot.repos[r]?.runs ?? [])
    all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    if (mode === 'active') all = all.filter((r) => r.status !== 'completed')
    if (mode === 'failed') all = all.filter((r) => runTone(r) === 'bad')
    if (mode === 'mine') all = all.filter((r) => r.actor === viewer)
    if (branch) all = all.filter((r) => r.branch === branch)
    if (workflow) all = all.filter((r) => matches(r.name, String(workflow)))
    if (event) all = all.filter((r) => r.event === event)
    if (actor) all = all.filter((r) => matches(r.actor, String(actor)))
    if (latestOnly) {
      const seen = new Set<string>()
      all = all.filter((r) => {
        const key = `${r.repo}:${r.workflowId}:${r.branch}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    if (filter) all = all.filter((r) => matches(`${r.repo} ${r.name} ${r.title} ${r.branch} ${r.actor} ${r.event}`, filter))
    return all.slice(0, Number(limit) || 30)
  }, [snapshot.repos, repos.join(), mode, branch, latestOnly, filter, limit, viewer, workflow, event, actor])

  // Only repos with deploy-looking workflows load deployments, to label those runs with where they deployed.
  const deployRepos = [...new Set(runs.filter((r) => /deploy|release/i.test(r.name)).map((r) => r.repo))]
  const { data: deployments } = useDeployments(deployRepos)
  const deployedTo = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const d of deployments.flatMap((r) => r.deployments))
      if (d.runId && !map.get(d.runId)?.includes(d.environment)) map.set(d.runId, [...(map.get(d.runId) ?? []), d.environment])
    return map
  }, [deployments])

  if (!runs.length) return <Empty>{EMPTY[mode as string] ?? 'No workflow runs.'}</Empty>
  const multiRepo = repos.length > 1

  return (
    <ul className="list">
      {runs.map((run) => {
        const tone = runTone(run)
        const active = run.status !== 'completed'
        return (
          <li key={run.id} className="row clickable" onClick={() => pushModal({ kind: 'run', run })}>
            <StatusIcon tone={tone} title={run.conclusion ?? run.status} />
            <div className="row-main">
              <div className="row-title">
                <span className="strong">{run.name}</span>
                {run.title !== run.name && <span className="dim"> · {run.title}</span>}
              </div>
              <div className="row-meta">
                {multiRepo && <span className="chip">{shortRepo(run.repo)}</span>}
                {deployedTo.get(run.id)?.map((env) => (
                  <span key={env} className="chip chip-env" title={`Deployed to ${env}`}>
                    ⇢ {env}
                  </span>
                ))}
                <span className="mono">{run.branch}</span>
                <span>{run.event}</span>
                <span>#{run.runNumber}{run.attempt > 1 ? ` (attempt ${run.attempt})` : ''}</span>
                <Avatar src={run.actorAvatar} login={run.actor} size={14} />
              </div>
            </div>
            <div className="row-side">
              <span className={active ? 'live' : 'dim'}>{active ? duration(run.startedAt, now) : duration(run.startedAt, run.updatedAt)}</span>
              <span className="dim small">{timeAgo(run.createdAt, now)}</span>
            </div>
            <div className="row-actions">
              {active && <IconButton icon="stop" title="Cancel run" onClick={() => void cancel(run)} />}
              {!active && tone === 'bad' && <IconButton icon="rerun" title="Re-run failed jobs" onClick={() => void rerun(run, true)} />}
              {!active && <IconButton icon="refresh" title="Re-run all jobs" onClick={() => void rerun(run, false)} />}
              <WatchIconButton run={run} />
              <IconButton icon="external" title="Open on GitHub" onClick={() => void api.openExternal(run.url)} />
            </div>
          </li>
        )
      })}
    </ul>
  )
})
