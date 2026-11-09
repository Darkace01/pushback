import { memo } from 'react'
import { Empty, IconButton, runTone, StatusIcon } from '../components/ui'
import { matches, timeAgo, useNow } from '../lib/format'
import { api, useSettings, useSnapshot, widgetRepos } from '../lib/store'
import { pushModal } from '../lib/ui'
import type { WidgetProps } from './types'

export const WorkflowsWidget = memo(function WorkflowsWidget({ widget, filter }: WidgetProps) {
  const snapshot = useSnapshot()
  const settings = useSettings()
  const now = useNow()
  const repos = widgetRepos(widget.repos, settings.repos)
  const dispatchableOnly = widget.options.dispatchableOnly !== false

  const groups = repos
    .map((repo) => {
      const state = snapshot.repos[repo]
      const workflows = (state?.workflows ?? []).filter(
        (w) => (!dispatchableOnly || w.dispatchable) && (!filter || matches(`${repo} ${w.name} ${w.path}`, filter))
      )
      return { repo, state, workflows }
    })
    .filter((g) => g.workflows.length)

  if (!groups.length) return <Empty>{dispatchableOnly ? 'No workflows with a workflow_dispatch trigger.' : 'No workflows.'}</Empty>

  return (
    <div className="list">
      {groups.map(({ repo, state, workflows }) => (
        <section key={repo}>
          {repos.length > 1 && <h4 className="group-head">{repo}</h4>}
          <ul>
            {workflows.map((w) => {
              const last = state?.runs.find((r) => r.workflowId === w.id)
              return (
                <li key={w.id} className="row">
                  {last ? <StatusIcon tone={runTone(last)} title={last.conclusion ?? last.status} /> : <StatusIcon tone="muted" title="No recent runs" />}
                  <div className="row-main">
                    <div className="row-title strong">{w.name}</div>
                    <div className="row-meta">
                      <span className="mono">{w.path.replace('.github/workflows/', '')}</span>
                      {last && <span>last run {timeAgo(last.createdAt, now)}</span>}
                      {w.inputs.length > 0 && <span>{w.inputs.length} input{w.inputs.length > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                  <div className="row-side row-side-inline">
                    {w.dispatchable && (
                      <button className="btn btn-primary btn-sm" onClick={() => pushModal({ kind: 'dispatch', workflow: w })}>
                        ▶ Run
                      </button>
                    )}
                    {w.path.startsWith('.github/workflows/') && (
                      <button className="btn btn-sm" title="View the workflow file and its triggers" onClick={() => pushModal({ kind: 'workflow-file', repo, path: w.path, name: w.name })}>
                        View file
                      </button>
                    )}
                    <IconButton icon="external" title="Open on GitHub" onClick={() => void api.openExternal(w.url)} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
})
