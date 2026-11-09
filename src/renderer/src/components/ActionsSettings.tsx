import { useState } from 'react'
import { actionsNameError, cachesByRef, formatBytes } from '../../../shared/actionsAdmin'
import type { ActionsAdminAction, ActionsAdminKind, ActionsList, ActionsVariable } from '../../../shared/types'
import { matches, timeAgo, useNow } from '../lib/format'
import { webUrl } from '../lib/hosts'
import { api, toast } from '../lib/store'
import { invalidate, useLoad } from '../lib/useLoad'
import type { SectionProps } from './RepoWorkspace'
import { Empty, IconButton, Segmented, Skeleton, StatusIcon } from './ui'

// A repo's Actions settings: secrets, variables, self-hosted runners and caches. Only the open tab is fetched, and
// only while this section is shown (never by the poller). Secret values are write-only: GitHub never returns them,
// and the value you type goes to the main process, which encrypts it before it is sent.

const TABS: [ActionsAdminKind, string][] = [
  ['secrets', 'Secrets'],
  ['variables', 'Variables'],
  ['runners', 'Runners'],
  ['caches', 'Caches']
]

const SETTINGS_PATH: Record<ActionsAdminKind, string> = {
  secrets: 'settings/secrets/actions',
  variables: 'settings/variables/actions',
  runners: 'settings/actions/runners',
  caches: 'actions/caches'
}

export function ActionsSettingsSection({ repo }: SectionProps) {
  const [tab, setTab] = useState<ActionsAdminKind>('secrets')
  return (
    <div className="repo-tab actions-admin">
      <div className="ws-toolbar">
        <Segmented value={tab} onChange={setTab} options={TABS} />
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void api.openExternal(webUrl(repo, SETTINGS_PATH[tab]))}>
          Open in browser
        </button>
      </div>
      {tab === 'secrets' && <Secrets key={repo} repo={repo} />}
      {tab === 'variables' && <Variables key={repo} repo={repo} />}
      {tab === 'runners' && <Runners key={repo} repo={repo} />}
      {tab === 'caches' && <Caches key={repo} repo={repo} />}
    </div>
  )
}

/** Runs a change, reports it, and refreshes the open lists. Returns whether it worked. */
async function act(repo: string, action: ActionsAdminAction, done: string): Promise<boolean> {
  const r = await api.actionsAdminAct(repo, action)
  if (!r.ok) {
    toast(`Couldn't save: ${r.error}`, 'error')
    invalidate(repo)
    return false
  }
  toast(done, 'ok')
  invalidate(repo)
  return true
}

/** The shared loading / refused / empty states of a list. */
function ListState<T>({ list, error, empty }: { list?: ActionsList<T>; error?: string; empty: string }) {
  if (error) return <p className="del">{error}</p>
  if (!list) return <Skeleton rows={5} />
  if (list.unavailable) return <Empty>{list.unavailable}</Empty>
  if (!list.items.length) return <Empty>{empty}</Empty>
  return null
}

function More({ list }: { list: ActionsList<unknown> }) {
  return list.total > list.items.length ? <p className="dim small">Showing {list.items.length} of {list.total}. Open in browser to see the rest.</p> : null
}

/** A name + value form, for a new or existing secret or variable. */
function EntryForm({ initial, secret, nameFixed, onSave, onCancel }: {
  initial?: { name: string; value: string }
  secret?: boolean
  nameFixed?: boolean
  onSave: (name: string, value: string) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [value, setValue] = useState(initial?.value ?? '')
  const [busy, setBusy] = useState(false)
  const problem = actionsNameError(name)
  return (
    <form
      className="inline-form actions-admin-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (problem || busy) return
        setBusy(true)
        const ok = await onSave(name, value)
        setBusy(false)
        if (ok) onCancel()
      }}
    >
      <input
        autoFocus={!nameFixed}
        className="mono"
        placeholder="NAME"
        aria-label="Name"
        value={name}
        disabled={nameFixed}
        onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
      />
      {secret ? (
        <input autoFocus={nameFixed} type="password" autoComplete="off" placeholder={initial ? 'New value' : 'Value'} aria-label="Value" value={value} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <textarea autoFocus={nameFixed} className="mono" rows={Math.min(6, value.split('\n').length)} placeholder="Value" aria-label="Value" value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      <div className="inline">
        {name && problem && <span className="del small">{problem}</span>}
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" disabled={!!problem || busy || (secret && !value)}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {secret && <span className="dim small">The value is encrypted before it leaves Pushback. Nobody can read it back, including you.</span>}
    </form>
  )
}

function Secrets({ repo }: { repo: string }) {
  const now = useNow()
  const { data, error } = useLoad(repo, () => api.actionsAdmin(repo, 'secrets'), [])
  const [editing, setEditing] = useState<string | null>(null)
  const save = (name: string, value: string) => act(repo, { kind: 'set-secret', name, value }, `Saved secret ${name}`)
  const remove = (name: string) => {
    if (!confirm(`Delete the secret ${name}? Workflows that use it will get an empty value. This can't be undone.`)) return
    void act(repo, { kind: 'delete-secret', name }, `Deleted secret ${name}`)
  }
  return (
    <>
      {!data?.unavailable && (
        <div className="ws-toolbar">
          <span className="dim small">Secret values can't be read back. You can replace a value or delete the secret.</span>
          <span className="spacer" />
          {editing !== '' && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing('')}>
              New secret
            </button>
          )}
        </div>
      )}
      {editing === '' && <EntryForm secret onSave={save} onCancel={() => setEditing(null)} />}
      <ListState list={data} error={error} empty="This repo has no Actions secrets." />
      {data && !data.unavailable && data.items.length > 0 && (
        <ul className="list">
          {data.items.map((s) =>
            editing === s.name ? (
              <li key={s.name}>
                <EntryForm secret nameFixed initial={{ name: s.name, value: '' }} onSave={save} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={s.name} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="strong mono">{s.name}</span>
                  </div>
                  <div className="row-meta">
                    <span>Updated {timeAgo(s.updatedAt, now)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="btn btn-sm" onClick={() => setEditing(s.name)}>
                    Update
                  </button>
                  <IconButton icon="trash" title={`Delete ${s.name}`} onClick={() => remove(s.name)} />
                </div>
              </li>
            )
          )}
        </ul>
      )}
      {data && <More list={data} />}
    </>
  )
}

function Variables({ repo }: { repo: string }) {
  const now = useNow()
  const [q, setQ] = useState('')
  const { data, error } = useLoad(repo, () => api.actionsAdmin(repo, 'variables'), [])
  const [editing, setEditing] = useState<string | null>(null)
  const save = (existing?: ActionsVariable) => (name: string, value: string) =>
    act(repo, { kind: 'set-variable', name, value, existing: existing?.name }, `Saved variable ${name}`)
  const remove = (name: string) => {
    if (!confirm(`Delete the variable ${name}? Workflows that use it will get an empty value.`)) return
    void act(repo, { kind: 'delete-variable', name }, `Deleted variable ${name}`)
  }
  const items = data?.items.filter((v) => !q || matches(`${v.name} ${v.value}`, q))
  return (
    <>
      {!data?.unavailable && (
        <div className="ws-toolbar">
          <input className="ws-filter" placeholder="Filter variables…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="spacer" />
          {editing !== '' && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing('')}>
              New variable
            </button>
          )}
        </div>
      )}
      {editing === '' && <EntryForm onSave={save()} onCancel={() => setEditing(null)} />}
      <ListState list={data} error={error} empty="This repo has no Actions variables." />
      {items && !data?.unavailable && items.length > 0 && (
        <ul className="list">
          {items.map((v) =>
            editing === v.name ? (
              <li key={v.name}>
                <EntryForm initial={v} onSave={save(v)} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={v.name} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="strong mono">{v.name}</span>
                  </div>
                  <div className="row-meta">
                    <span className="mono actions-admin-value" title={v.value}>
                      {v.value}
                    </span>
                    <span>Updated {timeAgo(v.updatedAt, now)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <IconButton icon="copy" title="Copy value" onClick={() => void navigator.clipboard.writeText(v.value).then(() => toast('Value copied', 'ok'))} />
                  <button className="btn btn-sm" onClick={() => setEditing(v.name)}>
                    Edit
                  </button>
                  <IconButton icon="trash" title={`Delete ${v.name}`} onClick={() => remove(v.name)} />
                </div>
              </li>
            )
          )}
        </ul>
      )}
      {data && <More list={data} />}
    </>
  )
}

function Runners({ repo }: { repo: string }) {
  const { data, error } = useLoad(repo, () => api.actionsAdmin(repo, 'runners'), [])
  return (
    <>
      <ListState list={data} error={error} empty="No self-hosted runners are registered for this repo. Jobs run on GitHub-hosted runners (organisation runners aren't listed here)." />
      {data && !data.unavailable && data.items.length > 0 && (
        <ul className="list">
          {data.items.map((r) => (
            <li key={r.id} className="row">
              <StatusIcon tone={r.status === 'offline' ? 'muted' : r.busy ? 'run' : 'ok'} title={r.status} />
              <div className="row-main">
                <div className="row-title">
                  <span className="strong">{r.name}</span>
                  <span className={`badge ${r.status === 'online' ? 'badge-ok' : 'badge-muted'}`}>{r.status}</span>
                  {r.busy && <span className="badge badge-warn">busy</span>}
                </div>
                <div className="row-meta">
                  <span>{r.os}</span>
                  {r.labels.map((l) => (
                    <span key={l} className="chip">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <More list={data} />}
    </>
  )
}

function Caches({ repo }: { repo: string }) {
  const now = useNow()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, error } = useLoad(repo, () => api.actionsAdmin(repo, 'caches'), [])
  const refs = data ? cachesByRef(data.items) : []
  const items = data?.items.filter((c) => !q || matches(`${c.key} ${c.ref}`, q))
  const remove = async (id: number, key: string) => {
    if (!confirm(`Delete the cache ${key}? The next run that needs it rebuilds it from scratch.`)) return
    await act(repo, { kind: 'delete-cache', id }, 'Deleted cache')
  }
  const clearRef = async (ref: string, count: number) => {
    if (!confirm(`Delete all ${count} cache${count === 1 ? '' : 's'} for ${ref}? The next runs on it rebuild them from scratch.`)) return
    setBusy(true)
    await act(repo, { kind: 'delete-caches-for-ref', ref }, `Deleted the caches for ${ref}`)
    setBusy(false)
  }
  return (
    <>
      {data && !data.unavailable && (
        <div className="ws-toolbar">
          <span className="strong">
            {formatBytes(data.usageBytes)} in {data.usageCount} cache{data.usageCount === 1 ? '' : 's'}
          </span>
          <span className="dim small">GitHub evicts the least recently used caches once a repo passes 10 GB.</span>
          <span className="spacer" />
          <input className="ws-filter" placeholder="Filter by key or ref…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <ListState list={data} error={error} empty="This repo has no Actions caches." />
      {refs.length > 0 && (
        <section>
          <h3 className="cleanup-title">
            By ref <span className="dim small">CI acting strangely? Clear the caches for the branch and re-run.</span>
          </h3>
          <ul className="list">
            {refs.map((r) => (
              <li key={r.ref} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="mono">{r.ref}</span>
                  </div>
                  <div className="row-meta">
                    <span>
                      {r.count} cache{r.count === 1 ? '' : 's'} · {formatBytes(r.size)}
                    </span>
                  </div>
                </div>
                <div className="row-actions show">
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void clearRef(r.ref, r.count)}>
                    Delete all
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {items && items.length > 0 && (
        <section>
          <h3 className="cleanup-title">Caches</h3>
          <ul className="list">
            {items.map((c) => (
              <li key={c.id} className="row">
                <div className="row-main">
                  <div className="row-title">
                    <span className="mono actions-admin-value" title={c.key}>
                      {c.key}
                    </span>
                  </div>
                  <div className="row-meta">
                    <span className="mono">{c.ref}</span>
                    <span>{formatBytes(c.size)}</span>
                    <span>last used {timeAgo(c.lastUsedAt, now)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <IconButton icon="trash" title="Delete cache" onClick={() => void remove(c.id, c.key)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && <More list={data} />}
    </>
  )
}
