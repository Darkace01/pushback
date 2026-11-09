import { useState } from 'react'
import { byCategory } from '../../../shared/collab'
import { matches, timeAgo, useNow } from '../lib/format'
import { webUrl } from '../lib/hosts'
import { openDiscussion } from '../lib/open'
import { api } from '../lib/store'
import { useLoad } from '../lib/useLoad'
import type { SectionProps } from './RepoWorkspace'
import { Avatar, Empty, Skeleton, StatusIcon } from './ui'

/** A repo's discussions, most recently active first, grouped by category. */
export function DiscussionsSection({ repo }: SectionProps) {
  const now = useNow()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const { data, error } = useLoad(repo, () => api.listDiscussions(repo), [])

  if (error) return <p className="del">{error}</p>
  if (!data) return <Skeleton rows={6} />
  if (!data.enabled)
    return (
      <Empty>
        Discussions are turned off for this repository. A maintainer can turn them on in the repo's settings on GitHub (Settings › General › Features).
      </Empty>
    )

  const shown = data.discussions.filter((d) => (!category || d.category.id === category) && (!q || matches(`#${d.number} ${d.title} ${d.author}`, q)))
  const groups = byCategory(data.categories, shown)

  return (
    <>
      <div className="ws-toolbar">
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="ws-filter" placeholder="Filter discussions…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => void api.openExternal(webUrl(repo, '/discussions/new/choose'))}>
          New discussion
        </button>
      </div>
      {!groups.length ? (
        <Empty>{q || category ? 'No discussions match.' : 'No discussions yet.'}</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.category.id} className="discussion-group">
            <h3 className="ws-group-label">
              {g.category.name} <span className="dim">{g.discussions.length}</span>
            </h3>
            <ul className="list repo-tab">
              {g.discussions.map((d) => (
                <li key={d.number} className="row clickable" onClick={() => openDiscussion(repo, d.number)}>
                  <StatusIcon tone={d.answered ? 'ok' : d.closed ? 'muted' : 'warn'} title={d.answered ? 'answered' : d.answered === false ? 'unanswered' : d.closed ? 'closed' : 'open'} />
                  <div className="row-main">
                    <div className="row-title">
                      <span className="strong">{d.title}</span>
                      {d.answered === true && <span className="badge badge-ok">Answered</span>}
                      {d.closed && <span className="badge badge-muted">Closed</span>}
                    </div>
                    <div className="row-meta">
                      <span>#{d.number}</span>
                      <Avatar src={d.authorAvatar} login={d.author} size={14} />
                      <span>{d.author}</span>
                      <span title={`${d.comments} comment${d.comments === 1 ? '' : 's'}`}>💬 {d.comments}</span>
                      {d.upvotes > 0 && <span>▲ {d.upvotes}</span>}
                    </div>
                  </div>
                  <span className="dim small">{timeAgo(d.updatedAt, now)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  )
}
