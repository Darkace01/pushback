import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { PrDetail, PrFile, ReviewThread } from '../../../shared/types'
import { anchorOf, parsePatch, suggestionFor, type DiffLine } from '../../../shared/diff'
import { timeAgo, useNow } from '../lib/format'
import { api, toast } from '../lib/store'
import { Markdown } from './Markdown'
import { Avatar } from './ui'

const key = (side: 'LEFT' | 'RIGHT', line: number) => `${side}:${line}`

/** The Files tab: each file's diff with its review threads under their lines, and a composer on any line. */
export function ReviewFiles({ pr }: { pr: PrDetail }) {
  const [threads, setThreads] = useState<ReviewThread[]>()
  const [error, setError] = useState<string>()
  const load = useCallback(
    () =>
      api.prThreads(pr.repo, pr.number).then(
        (t) => (setThreads(t), setError(undefined)),
        (e: Error) => (setThreads([]), setError(e.message))
      ),
    [pr.repo, pr.number]
  )
  useEffect(() => void load(), [load])

  const open = threads?.filter((t) => !t.resolved).length ?? 0
  return (
    <div className="files">
      {threads && threads.length > 0 && (
        <p className="dim small">
          {threads.length} review thread{threads.length === 1 ? '' : 's'}, {open} unresolved.
        </p>
      )}
      {error && <p className="dim small">Couldn't load review comments: {error}</p>}
      {pr.changedFiles > pr.files.length && <p className="dim small">Showing the first {pr.files.length} of {pr.changedFiles} files.</p>}
      {pr.files.map((f) => (
        <FileDiff key={f.filename} pr={pr} file={f} threads={threads?.filter((t) => t.path === f.filename) ?? []} onChange={load} />
      ))}
    </div>
  )
}

function FileDiff({ pr, file, threads, onChange }: { pr: PrDetail; file: PrFile; threads: ReviewThread[]; onChange: () => void }) {
  const lines = useMemo(() => parsePatch(file.patch), [file.patch])
  // Big diffs start collapsed so the list stays scannable, unless someone commented on them.
  const [open, setOpen] = useState(lines.length > 0 && (lines.length < 300 || threads.length > 0))
  const [composing, setComposing] = useState<string>()
  const byLine = useMemo(() => {
    const map = new Map<string, ReviewThread[]>()
    for (const t of threads) if (t.line !== null) map.set(key(t.side, t.line), [...(map.get(key(t.side, t.line)) ?? []), t])
    return map
  }, [threads])
  const outdated = threads.filter((t) => t.line === null)
  const canComment = pr.state === 'open'

  return (
    <div className="file">
      <button className="file-head" onClick={() => setOpen(!open)}>
        <span className="dim">{open ? '▾' : '▸'}</span>
        <span className={`file-status file-${file.status}`}>{file.status}</span>
        <span className="mono">{file.filename}</span>
        {threads.length > 0 && <span className="badge badge-muted">{threads.length} 💬</span>}
        <span className="spacer" />
        <span className="add small">+{file.additions}</span>
        <span className="del small">−{file.deletions}</span>
      </button>
      {open && outdated.length > 0 && (
        <div className="outdated">
          <p className="dim small">Comments on code that has since changed</p>
          {outdated.map((t) => (
            <Thread key={t.id} pr={pr} thread={t} onChange={onChange} />
          ))}
        </div>
      )}
      {open &&
        (lines.length ? (
          <div className="diff review-diff" role="table" aria-label={`Diff of ${file.filename}`}>
            {lines.map((l, i) => {
              const anchor = anchorOf(l)
              const k = anchor && key(anchor.side, anchor.line)
              const here = (k && byLine.get(k)) || []
              return (
                <Fragment key={i}>
                  <div className={`diff-line ${CLASS[l.kind]}`} role="row">
                    <span className="ln">{l.oldLine ?? ''}</span>
                    <span className="ln">{l.newLine ?? ''}</span>
                    {canComment && anchor ? (
                      <button className="ln-add" title="Comment on this line" aria-label={`Comment on line ${anchor.line}`} onClick={() => setComposing(k!)}>
                        +
                      </button>
                    ) : (
                      <span className="ln-add" />
                    )}
                    <span className="code">{l.text || ' '}</span>
                  </div>
                  {here.map((t) => (
                    <Thread key={t.id} pr={pr} thread={t} onChange={onChange} />
                  ))}
                  {composing === k && anchor && (
                    <Composer
                      line={l}
                      onCancel={() => setComposing(undefined)}
                      onSubmit={async (body) => {
                        const r = await api.commentLine(pr.repo, pr.number, { path: file.filename, line: anchor.line, side: anchor.side, body, commitId: pr.headSha })
                        if (!r.ok) return toast(`Comment failed: ${r.error}`, 'error'), false
                        setComposing(undefined)
                        onChange()
                        return true
                      }}
                    />
                  )}
                </Fragment>
              )
            })}
          </div>
        ) : (
          <p className="dim small file-note">No diff to show (binary, renamed, or too large).</p>
        ))}
    </div>
  )
}

const CLASS: Record<DiffLine['kind'], string> = { hunk: 'hunk', add: 'ins', del: 'rem', ctx: '', meta: 'meta' }

function Composer({ line, onSubmit, onCancel, placeholder = 'Comment on this line (Markdown supported) — Ctrl+Enter to send' }: {
  line?: DiffLine
  onSubmit: (body: string) => Promise<boolean>
  onCancel?: () => void
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const suggestion = line && suggestionFor(line)
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    const ok = await onSubmit(text.trim())
    setBusy(false)
    if (ok) setText('')
  }
  return (
    <div className="line-composer">
      <textarea
        rows={3}
        autoFocus={!!line}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send()
          if (e.key === 'Escape' && onCancel) (e.stopPropagation(), onCancel())
        }}
      />
      <div className="inline">
        {suggestion && (
          <button className="btn btn-sm" type="button" onClick={() => setText((t) => (t ? `${t}\n\n` : '') + suggestion)} title="Propose new text for this line">
            Suggest a change
          </button>
        )}
        <span className="spacer" />
        {onCancel && (
          <button className="btn btn-sm" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-sm btn-primary" type="button" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? 'Sending…' : line ? 'Comment' : 'Reply'}
        </button>
      </div>
    </div>
  )
}

function Thread({ pr, thread, onChange }: { pr: PrDetail; thread: ReviewThread; onChange: () => void }) {
  const now = useNow()
  // Resolved conversations fold away, like on GitHub.
  const [expanded, setExpanded] = useState(!thread.resolved)
  const [busy, setBusy] = useState(false)
  const first = thread.comments[0]

  const toggleResolved = async () => {
    setBusy(true)
    const r = await api.resolveThread(pr.repo, thread.id, !thread.resolved)
    setBusy(false)
    if (!r.ok) return toast(`Couldn't ${thread.resolved ? 'unresolve' : 'resolve'}: ${r.error}`, 'error')
    onChange()
  }

  return (
    <div className={`review-thread${thread.resolved ? ' resolved' : ''}`} aria-label="Review thread">
      <div className="review-thread-head">
        <button className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▾' : '▸'} {thread.resolved ? 'Resolved' : thread.outdated ? 'Outdated' : 'Conversation'} · {thread.comments.length} comment{thread.comments.length === 1 ? '' : 's'}
          {!expanded && first && <span className="dim"> · {first.author}</span>}
        </button>
        <span className="spacer" />
        {pr.state === 'open' && (
          <button className="btn btn-sm" disabled={busy} onClick={() => void toggleResolved()}>
            {thread.resolved ? 'Unresolve' : 'Resolve conversation'}
          </button>
        )}
      </div>
      {expanded && (
        <>
          {thread.comments.map((c) => (
            <article key={c.id} className="comment">
              <header>
                <Avatar src={c.authorAvatar} login={c.author} size={18} />
                <span className="strong">{c.author}</span>
                <span className="dim">{timeAgo(c.createdAt, now)}</span>
              </header>
              <Markdown html={c.bodyHtml} />
            </article>
          ))}
          {pr.state === 'open' && first && (
            <Composer
              placeholder="Reply — Ctrl+Enter to send"
              onSubmit={async (body) => {
                const r = await api.replyToThread(pr.repo, pr.number, first.id, body)
                if (!r.ok) return toast(`Reply failed: ${r.error}`, 'error'), false
                onChange()
                return true
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
