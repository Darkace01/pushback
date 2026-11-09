import { useState } from 'react'
import type { ProjectItem } from '../../../shared/types'
import { api, toast } from '../lib/store'
import { useLoad } from '../lib/useLoad'

/**
 * The Projects (v2) an issue or PR is in, with a picker for its Status in each. Loaded once when the view opens
 * (one GraphQL query); a token without the project scopes gets an explanation instead of an error.
 */
export function ProjectsPanel({ repo, number }: { repo: string; number: number }) {
  const { data, error, reload } = useLoad(repo, () => api.itemProjects(repo, number), [number])
  if (!data && !error) return null
  return (
    <section className="projects-panel" aria-label="Projects">
      <span className="dim small strong">Projects</span>
      {error ? (
        <span className="dim small">Couldn't load projects: {error}</span>
      ) : data!.missingScope ? (
        <span className="dim small">{data!.missingScope}</span>
      ) : !data!.items.length ? (
        <span className="dim small">Not in any project.</span>
      ) : (
        data!.items.map((p) => <ProjectRow key={p.itemId} repo={repo} item={p} onChange={reload} />)
      )}
    </section>
  )
}

function ProjectRow({ repo, item, onChange }: { repo: string; item: ProjectItem; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const status = item.status
  const set = async (optionId: string | null) => {
    if (!status) return
    setBusy(true)
    const r = await api.setProjectStatus(repo, { projectId: item.projectId, itemId: item.itemId, fieldId: status.fieldId, optionId })
    setBusy(false)
    if (!r.ok) return toast(`Couldn't change the status: ${r.error}`, 'error')
    toast(`Status in ${item.title}: ${status.options.find((o) => o.id === optionId)?.name ?? 'cleared'}`, 'ok')
    // Reloads this panel and anything else showing the repo.
    onChange()
  }
  return (
    <span className="project-chip">
      <button className="link" title="Open the project on GitHub" onClick={() => void api.openExternal(item.url)}>
        {item.title}
      </button>
      {item.closed && <span className="badge badge-muted">Closed</span>}
      {status ? (
        <select aria-label={`Status in ${item.title}`} disabled={busy} value={status.optionId ?? ''} onChange={(e) => void set(e.target.value || null)}>
          <option value="">No status</option>
          {status.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="dim small">no Status field</span>
      )}
    </span>
  )
}
