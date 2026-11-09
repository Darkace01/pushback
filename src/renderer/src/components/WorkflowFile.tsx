import { useMemo, useState } from 'react'
import { describeTrigger, eventChoices, explainTrigger } from '../../../shared/workflowTriggers'
import type { WorkflowFile } from '../../../shared/types'
import { webUrl } from '../lib/hosts'
import { api, toast, useSnapshot } from '../lib/store'
import { closeModal } from '../lib/ui'
import { useLoad } from '../lib/useLoad'
import { highlightLine } from '../lib/yamlHighlight'
import { RepoRail } from './RepoRail'
import { Modal, Skeleton, StatusIcon } from './ui'

const STATE: Record<string, string> = {
  disabled_manually: 'Disabled',
  disabled_inactivity: 'Disabled (inactive repo)',
  disabled_fork: 'Disabled on this fork',
  deleted: 'Deleted'
}

function Code({ source }: { source: string }) {
  const lines = useMemo(() => source.replace(/\n$/, '').split(/\r?\n/), [source])
  return (
    <pre className="code-view" aria-label="Workflow file">
      {lines.map((line, i) => (
        <div key={i} className="code-line">
          <span className="ln" aria-hidden="true">
            {i + 1}
          </span>
          <code>
            {highlightLine(line).map((t, j) => (t.kind === 'plain' ? t.text : <span key={j} className={`tok-${t.kind}`}>{t.text}</span>))}
          </code>
        </div>
      ))}
    </pre>
  )
}

/** "Why didn't it run?": pick an event, a branch or tag, and the changed files; the answer updates as you type. */
function WhyNot({ file, defaultBranch }: { file: WorkflowFile; defaultBranch?: string }) {
  const events = eventChoices(file.triggers)
  const [event, setEvent] = useState(events.includes('push') ? 'push' : events[0])
  const [ref, setRef] = useState(defaultBranch ?? '')
  const [isTag, setIsTag] = useState(false)
  const [paths, setPaths] = useState('')
  const [message, setMessage] = useState('')
  const verdict = explainTrigger(file.triggers, {
    event,
    branch: !isTag ? ref.trim() || undefined : undefined,
    tag: isTag ? ref.trim() || undefined : undefined,
    paths: paths.split(/\r?\n|,/),
    message: message || undefined,
    defaultBranch,
    state: file.state
  })
  return (
    <section className="why-not" aria-label="Why didn't it run">
      <h4>Why didn't it run?</h4>
      <div className="why-form">
        <label>
          Event
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            {events.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <label>
          {isTag ? 'Tag' : event.startsWith('pull_request') ? 'Base branch' : 'Branch'}
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={isTag ? 'v1.2.0' : 'main'} spellCheck={false} />
        </label>
        {event === 'push' && (
          <label className="why-tag">
            <input type="checkbox" checked={isTag} onChange={(e) => setIsTag(e.target.checked)} /> It's a tag
          </label>
        )}
        <label className="why-wide">
          Changed files (one per line)
          <textarea rows={3} value={paths} onChange={(e) => setPaths(e.target.value)} placeholder={'src/index.ts\ndocs/README.md'} spellCheck={false} />
        </label>
        <label className="why-wide">
          Commit message
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional: checks for [skip ci]" />
        </label>
      </div>
      <div className={`why-verdict ${verdict.runs ? 'runs' : 'skips'}`} role="status">
        <StatusIcon tone={verdict.runs ? 'ok' : 'bad'} />
        <div>
          <strong>{verdict.runs ? `It would run for this ${event}.` : `It wouldn't run for this ${event}:`}</strong>
          {verdict.reasons.length > 0 && (
            <ul>
              {verdict.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {verdict.notes.map((n) => (
            <p key={n} className="dim small">
              {n}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}

/** A workflow's YAML, read-only, with its triggers and a "why didn't it run?" check. */
export function WorkflowFileModal({ repo, path, ref, name }: { repo: string; path: string; ref?: string; name?: string }) {
  const defaultBranch = useSnapshot().repos[repo]?.defaultBranch
  const { data: file, error } = useLoad(repo, () => api.workflowFile(repo, path, ref), [path, ref])
  const title = file?.name ?? name ?? path.split('/').pop()!
  const url = file?.url ?? webUrl(repo, `/blob/${ref ?? defaultBranch ?? 'HEAD'}/${path}`)
  const disabled = file?.state && file.state !== 'active'

  return (
    <Modal title={`${repo} ${title}`} onClose={closeModal} panel side={<RepoRail repo={repo} />}>
      <div className="pr-head">
        <h1 className="pr-title">
          {title} {disabled && <span className="badge badge-warn">{STATE[file.state!] ?? file.state}</span>}
        </h1>
        <div className="row-meta">
          <span className="mono">{path}</span>
          <span>{ref ? <>at <span className="mono">{/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref}</span></> : `on ${defaultBranch ?? 'the default branch'}`}</span>
        </div>
        <div className="inline">
          <button className="btn btn-sm" disabled={!file} onClick={() => file && void navigator.clipboard.writeText(file.content).then(() => toast('Workflow copied', 'ok'))}>
            Copy YAML
          </button>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => void api.openExternal(url)}>
            Open in browser
          </button>
        </div>
      </div>
      {error && <p className="del">Couldn't load {path}: {error}</p>}
      {!file && !error && <Skeleton kind="text" rows={10} />}
      {file && (
        <>
          <section className="triggers" aria-label="Triggers">
            <h4>Triggers</h4>
            {file.triggers.error ? (
              <p className="del">{file.triggers.error}</p>
            ) : (
              <ul>
                {file.triggers.events.map((t) => (
                  <li key={t.event}>{describeTrigger(t)}</li>
                ))}
              </ul>
            )}
          </section>
          <WhyNot file={file} defaultBranch={defaultBranch} />
          <Code source={file.content} />
        </>
      )}
    </Modal>
  )
}
