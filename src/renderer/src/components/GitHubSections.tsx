import { useState, type ReactNode } from 'react'
import { dueLabel, milestoneProgress } from '../../../shared/collab'
import type { BranchInfo, CommitInfo, GraphCommit, MilestoneRef } from '../../../shared/types'
import { matches, timeAgo, useNow } from '../lib/format'
import { webUrl } from '../lib/hosts'
import { openIssue, openPr } from '../lib/open'
import { api, toast } from '../lib/store'
import { pushModal } from '../lib/ui'
import { useLoad } from '../lib/useLoad'
import { GitHubGraph } from './GitTools'
import { Markdown } from './Markdown'
import type { SectionProps } from './RepoWorkspace'
import { Avatar, Empty, IconButton, Segmented, Skeleton, StatusIcon } from './ui'

function Loading({ error }: { error?: string }) {
  return error ? <p className="del">{error}</p> : <Skeleton rows={6} />
}

function Filter({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="ws-filter" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
}

type MilestonePick = MilestoneRef | 'none' | null

export function IssuesSection({ repo }: SectionProps) {
  const now = useNow()
  const [view, setView] = useState<'issues' | 'milestones'>('issues')
  const [state, setState] = useState<'open' | 'closed'>('open')
  const [q, setQ] = useState('')
  const [milestone, setMilestone] = useState<MilestonePick>(null)
  const only = milestone === 'none' ? 'none' : milestone?.number
  const { data, error } = useLoad(repo, () => (view === 'issues' ? api.listIssues(repo, state, only) : new Promise<never>(() => {})), [state, only, view])
  const { data: milestones } = useLoad(repo, () => api.listMilestones(repo, 'open'), [])
  const issues = data?.filter((i) => !q || matches(`#${i.number} ${i.title} ${i.author} ${i.labels.map((l) => l.name).join(' ')} ${i.milestone?.title ?? ''}`, q))
  // A closed milestone picked from the milestones list isn't among the open ones, but must stay selectable.
  const picked = milestone && milestone !== 'none' && !milestones?.some((m) => m.number === milestone.number) ? [milestone] : []
  const choices: MilestoneRef[] = [...(milestones ?? []), ...picked]

  const viewSwitch = (
    <Segmented
      value={view}
      onChange={setView}
      options={[
        ['issues', 'Issues'],
        ['milestones', `Milestones${milestones?.length ? ` ${milestones.length}` : ''}`]
      ]}
    />
  )
  if (view === 'milestones')
    return (
      <MilestonesList
        repo={repo}
        toolbar={viewSwitch}
        onPick={(m) => {
          setMilestone({ number: m.number, title: m.title })
          setState('open')
          setView('issues')
        }}
      />
    )

  return (
    <>
      <div className="ws-toolbar">
        {viewSwitch}
        <Segmented value={state} onChange={setState} options={[['open', 'Open'], ['closed', 'Closed']]} />
        <select
          aria-label="Milestone"
          value={milestone === 'none' ? 'none' : (milestone?.number ?? '')}
          onChange={(e) => {
            const v = e.target.value
            setMilestone(v === '' ? null : v === 'none' ? 'none' : (choices.find((m) => m.number === Number(v)) ?? null))
          }}
        >
          <option value="">Any milestone</option>
          <option value="none">No milestone</option>
          {choices.map((m) => (
            <option key={m.number} value={m.number}>
              {m.title}
            </option>
          ))}
        </select>
        <Filter value={q} onChange={setQ} placeholder="Filter issues…" />
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => pushModal({ kind: 'new-issue', repo })}>
          New issue
        </button>
      </div>
      {!issues ? (
        <Loading error={error} />
      ) : !issues.length ? (
        <Empty>{q || milestone ? 'No issues match.' : state === 'open' ? 'No open issues. 🎉' : 'No closed issues.'}</Empty>
      ) : (
        <ul className="list repo-tab">
          {issues.map((i) => (
            <li key={i.number} className="row clickable" onClick={() => openIssue(repo, i.number)}>
              <StatusIcon tone={i.state === 'open' ? 'ok' : 'muted'} title={i.state} />
              <div className="row-main">
                <div className="row-title">
                  <span className="strong">{i.title}</span>
                  {i.labels.map((l) => (
                    <span key={l.name} className="label" style={{ ['--label' as string]: `#${l.color}` }}>
                      {l.name}
                    </span>
                  ))}
                </div>
                <div className="row-meta">
                  <span>#{i.number}</span>
                  <Avatar src={i.authorAvatar} login={i.author} size={14} />
                  <span>{i.author}</span>
                  {i.assignees.length > 0 && <span>→ {i.assignees.join(', ')}</span>}
                  {i.milestone && <span title="Milestone">⚑ {i.milestone.title}</span>}
                  {i.comments > 0 && <span>💬 {i.comments}</span>}
                </div>
              </div>
              <span className="dim small">{timeAgo(i.updatedAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Milestones with how far along they are; picking one lists its issues. */
function MilestonesList({ repo, toolbar, onPick }: { repo: string; toolbar: ReactNode; onPick: (m: MilestoneRef) => void }) {
  const now = useNow()
  const [state, setState] = useState<'open' | 'closed'>('open')
  const { data, error } = useLoad(repo, () => api.listMilestones(repo, state), [state])

  return (
    <>
      <div className="ws-toolbar">
        {toolbar}
        <Segmented value={state} onChange={setState} options={[['open', 'Open'], ['closed', 'Closed']]} />
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void api.openExternal(webUrl(repo, '/milestones/new'))}>
          New milestone
        </button>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : !data.length ? (
        <Empty>{state === 'open' ? 'No open milestones.' : 'No closed milestones.'}</Empty>
      ) : (
        <ul className="list repo-tab milestones">
          {data.map((m) => {
            const pct = milestoneProgress(m)
            const due = dueLabel(m.dueOn, now)
            return (
              <li key={m.number} className="row clickable" onClick={() => onPick(m)}>
                <div className="row-main">
                  <div className="row-title">
                    <span className="strong">{m.title}</span>
                    {m.state === 'closed' ? (
                      <span className="badge badge-muted">Closed{m.closedAt ? ` ${timeAgo(m.closedAt, now)}` : ''}</span>
                    ) : (
                      <span className={`badge ${due.overdue ? 'badge-bad' : 'badge-muted'}`}>{due.text}</span>
                    )}
                  </div>
                  <div className="milestone-bar" role="progressbar" aria-label={`${m.title} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div className="row-meta">
                    <span className="strong">{pct}% complete</span>
                    <span>{m.openIssues} open</span>
                    <span>{m.closedIssues} closed</span>
                    {m.description && <span className="dim">{m.description}</span>}
                  </div>
                </div>
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <IconButton icon="external" title="Open on GitHub" onClick={() => void api.openExternal(m.url)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function BranchesSection({ repo, info }: SectionProps) {
  const now = useNow()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const base = info?.defaultBranch
  const { data, error, reload } = useLoad(repo, () => (base ? api.listBranches(repo, base) : new Promise<never>(() => {})), [base])
  const branches = data?.filter((b) => !q || matches(`${b.name} ${b.author} ${b.message}`, q))
  const [view, setView] = useState<'list' | 'graph'>('list')

  const create = async () => {
    const r = await api.createBranch(repo, name.trim(), from || base!)
    if (!r.ok) return toast(`Couldn't create the branch: ${r.error}`, 'error')
    toast(`Created ${name.trim()}`, 'ok')
    setCreating(false)
    setName('')
    reload()
  }
  const remove = async (branch: string) => {
    if (!confirm(`Delete the branch “${branch}” on GitHub? Its commits stay reachable from any PRs, but the branch itself is gone.`)) return
    const r = await api.deleteBranch(repo, branch)
    if (!r.ok) return toast(`Couldn't delete ${branch}: ${r.error}`, 'error')
    toast(`Deleted ${branch}`, 'ok')
    reload()
  }

  return (
    <>
      <div className="ws-toolbar">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            ['list', 'List'],
            ['graph', 'Graph']
          ]}
        />
        {view === 'list' && <Filter value={q} onChange={setQ} placeholder="Filter branches…" />}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => pushModal({ kind: 'new-pr', repo })}>
          New pull request
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(!creating)}>
          New branch
        </button>
      </div>
      {creating && (
        <form
          className="ws-toolbar inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void create()
          }}
        >
          <input autoFocus placeholder="new-branch-name" value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))} />
          <span className="dim small">from</span>
          <select value={from || base} onChange={(e) => setFrom(e.target.value)}>
            {data?.map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!name.trim()}>
            Create branch
          </button>
        </form>
      )}
      {!branches ? (
        <Loading error={error} />
      ) : view === 'graph' ? (
        <BranchGraph repo={repo} branches={data!} />
      ) : (
        <ul className="list repo-tab">
          {branches.map((b) => (
            <li key={b.name} className="row">
              <Avatar src={b.authorAvatar ?? ''} login={b.author} size={18} />
              <div className="row-main">
                <div className="row-title">
                  <span className="strong mono">{b.name}</span>
                  {b.isDefault && <span className="badge badge-ok">default</span>}
                  {b.openPr && (
                    <button className="chip chip-btn" onClick={() => openPr(repo, b.openPr!)}>
                      PR #{b.openPr}
                    </button>
                  )}
                </div>
                <div className="row-meta">
                  <span>{b.message}</span>
                  <span>
                    {b.author} · {timeAgo(b.date, now)}
                  </span>
                </div>
              </div>
              {!b.isDefault && (
                <span className="ahead-behind" title={`${b.ahead} ahead of, ${b.behind} behind ${base}`}>
                  <span className="add">↑{b.ahead}</span> <span className="del">↓{b.behind}</span>
                </span>
              )}
              <div className="row-actions">
                {!b.isDefault && !b.openPr && b.ahead > 0 && (
                  <button className="btn btn-sm" onClick={() => pushModal({ kind: 'new-pr', repo, head: b.name })}>
                    Open PR
                  </button>
                )}
                <IconButton icon="copy" title="Copy branch name" onClick={() => void navigator.clipboard.writeText(b.name).then(() => toast('Branch name copied', 'ok'))} />
                <IconButton icon="external" title="Open on GitHub" onClick={() => void api.openExternal(webUrl(repo, `/tree/${b.name}`))} />
                {!b.isDefault && <IconButton icon="trash" title="Delete branch" onClick={() => void remove(b.name)} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function CommitsSection({ repo, info }: SectionProps) {
  const [ref, setRef] = useState('')
  const [q, setQ] = useState('')
  const branch = ref || info?.defaultBranch
  const { data: branches } = useLoad(repo, () => (info ? api.listBranches(repo, info.defaultBranch) : new Promise<never>(() => {})), [info?.defaultBranch])
  const { data, error } = useLoad(repo, () => api.listCommits(repo, branch), [branch])
  const commits = data?.filter((c) => !q || matches(`${c.sha} ${c.message} ${c.author}`, q))

  return (
    <>
      <div className="ws-toolbar">
        <select value={branch ?? ''} onChange={(e) => setRef(e.target.value)}>
          {(branches ?? (branch ? [{ name: branch }] : [])).map((b) => (
            <option key={b.name}>{b.name}</option>
          ))}
        </select>
        <Filter value={q} onChange={setQ} placeholder="Filter by message, author or SHA…" />
      </div>
      {!commits ? (
        <Loading error={error} />
      ) : (
        <GitHubGraph commits={commits.map((c, i) => ({ ...toGraph(c), refs: i === 0 && !q ? [`head:${branch}`] : [] }))} />
      )}
    </>
  )
}

/** A GitHub commit as a graph row; clicking it opens the commit on GitHub. */
const toGraph = (c: CommitInfo): GraphCommit => ({
  sha: c.sha,
  parents: c.parents,
  subject: c.message.split('\n')[0],
  author: c.author,
  avatar: c.authorAvatar,
  date: c.date,
  refs: [],
  url: c.url
})

/** Recent history of the default branch and the 7 most recently updated branches, drawn as one graph. */
function BranchGraph({ repo, branches }: { repo: string; branches: BranchInfo[] }) {
  const names = [...branches.filter((b) => b.isDefault), ...branches.filter((b) => !b.isDefault)].slice(0, 8).map((b) => b.name)
  const { data, error } = useLoad(repo, () => api.branchGraph(repo, names), [names.join()])
  if (!data) return <Loading error={error} />
  return (
    <>
      <p className="dim small">
        The last 40 commits of {names.length === 1 ? 'the default branch' : `the default branch and the ${names.length - 1} most recently updated branches`}. Click a
        commit to open it on GitHub; link a clone for the full graph with every branch.
      </p>
      <GitHubGraph commits={data} />
    </>
  )
}

const size = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1e3)} KB`)

export function ReleasesSection({ repo }: SectionProps) {
  const now = useNow()
  const { data, error } = useLoad(repo, () => api.listReleases(repo), [])
  const [openId, setOpenId] = useState<number>()
  const latestId = data?.find((r) => !r.draft && !r.prerelease)?.id

  return (
    <>
      <div className="ws-toolbar">
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => pushModal({ kind: 'new-release', repo })}>
          New release
        </button>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : !data.length ? (
        <Empty>No releases yet.</Empty>
      ) : (
        <div className="releases">
          {data.map((r) => {
            const expanded = openId === r.id || (openId === undefined && r.id === data[0].id)
            return (
              <article key={r.id} className="comment">
                <header className="release-head" onClick={() => setOpenId(expanded ? -1 : r.id)}>
                  <span className="dim">{expanded ? '▾' : '▸'}</span>
                  <span className="strong">{r.name}</span>
                  <span className="chip mono">{r.tag}</span>
                  {r.id === latestId && <span className="badge badge-ok">Latest</span>}
                  {r.prerelease && <span className="badge badge-warn">Pre-release</span>}
                  {r.draft && <span className="badge badge-muted">Draft</span>}
                  <span className="spacer" />
                  <span className="dim small">
                    {r.author} · {timeAgo(r.publishedAt ?? r.createdAt, now)}
                  </span>
                  <IconButton icon="external" title="Open on GitHub" onClick={() => void api.openExternal(r.url)} />
                </header>
                {expanded && (
                  <>
                    <Markdown html={r.bodyHtml} repo={repo} empty="No release notes." />
                    {r.assets.length > 0 && (
                      <table className="assets">
                        <tbody>
                          {r.assets.map((a) => (
                            <tr key={a.name}>
                              <td>
                                <button className="link" onClick={() => void api.openExternal(a.url)}>
                                  {a.name}
                                </button>
                              </td>
                              <td className="dim">{size(a.size)}</td>
                              <td className="dim">{a.downloads.toLocaleString()} downloads</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
