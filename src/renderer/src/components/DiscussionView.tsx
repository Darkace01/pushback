import { useState } from 'react'
import type { DiscussionComment } from '../../../shared/types'
import { timeAgo, useNow } from '../lib/format'
import { webUrl } from '../lib/hosts'
import { openRepo } from '../lib/open'
import { api, toast } from '../lib/store'
import { closeModal } from '../lib/ui'
import { invalidate, useLoad } from '../lib/useLoad'
import { Markdown } from './Markdown'
import { RepoRail } from './RepoRail'
import { Avatar, Modal, Skeleton } from './ui'

/** One discussion: its body, the comments (with replies) and a box to add a comment. */
export function DiscussionModal({ repo, number }: { repo: string; number: number }) {
  const now = useNow()
  const { data: d, error } = useLoad(repo, () => api.discussionDetail(repo, number), [number])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const url = webUrl(repo, `/discussions/${number}`)

  const comment = async () => {
    if (!d) return
    setBusy(true)
    const r = await api.commentDiscussion(repo, d.id, text.trim())
    setBusy(false)
    if (!r.ok) return toast(`Comment failed: ${r.error}`, 'error')
    setText('')
    toast('Comment added', 'ok')
    // The section's comment count changes too.
    invalidate(repo)
  }

  return (
    <Modal title={`${repo} discussion #${number}`} onClose={closeModal} panel side={<RepoRail repo={repo} />}>
      <div className="pr-head">
        <h1 className="pr-title">
          {d?.title ?? `Discussion #${number}`} <span className="dim">#{number}</span>
        </h1>
        {d && (
          <div className="row-meta">
            <span className="chip">{d.category.name}</span>
            {d.answered === true && <span className="badge badge-state-merged">✓ Answered</span>}
            {d.answered === false && <span className="badge badge-state-open">Unanswered</span>}
            {d.closed && <span className="badge badge-muted">Closed</span>}
            {d.locked && <span className="badge badge-warn">Locked</span>}
            <Avatar src={d.authorAvatar} login={d.author} size={16} />
            <span>
              <span className="strong">{d.author}</span> started {timeAgo(d.createdAt, now)}
            </span>
            <span>▲ {d.upvotes}</span>
            <button className="link" onClick={() => openRepo(repo)}>
              {repo}
            </button>
          </div>
        )}
      </div>

      <div className="inline">
        <span className="spacer" />
        <button className="btn" onClick={() => void navigator.clipboard.writeText(url).then(() => toast('Link copied', 'ok'))}>
          Copy link
        </button>
        <button className="btn" onClick={() => void api.openExternal(url)}>
          Open in browser
        </button>
      </div>

      {error && <p className="del">Couldn't load this discussion: {error}</p>}
      {!d && !error && <Skeleton kind="text" rows={6} />}
      {d && (
        <div className="timeline">
          <article className="comment">
            <header>
              <Avatar src={d.authorAvatar} login={d.author} size={20} />
              <span className="strong">{d.author}</span>
              <span className="dim">{timeAgo(d.createdAt, now)}</span>
            </header>
            <Markdown html={d.bodyHtml} />
          </article>
          {d.comments.map((c) => (
            <Comment key={c.id} c={c} now={now} />
          ))}
          {d.comments.length < d.commentCount && (
            <p className="dim small">
              Showing the first {d.comments.length} of {d.commentCount} comments.{' '}
              <button className="link" onClick={() => void api.openExternal(url)}>
                See the rest on GitHub
              </button>
            </p>
          )}
          {d.locked ? (
            <p className="dim">This discussion is locked, so only maintainers can comment.</p>
          ) : (
            <div className="comment-box">
              <textarea
                rows={3}
                aria-label="Discussion comment"
                placeholder="Add to the discussion (Markdown supported) — Ctrl+Enter to send"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() && !busy) void comment()
                }}
              />
              <div className="inline">
                <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void comment()}>
                  {busy ? 'Sending…' : 'Comment'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function Comment({ c, now, reply }: { c: DiscussionComment; now: number; reply?: boolean }) {
  return (
    <article className={`comment${c.isAnswer ? ' discussion-answer' : ''}${reply ? ' discussion-reply' : ''}`}>
      <header>
        <Avatar src={c.authorAvatar} login={c.author} size={reply ? 16 : 20} />
        <span className="strong">{c.author}</span>
        <span className="dim">{timeAgo(c.createdAt, now)}</span>
        {c.isAnswer && <span className="badge badge-state-merged">✓ Answer</span>}
      </header>
      <Markdown html={c.bodyHtml} empty="" />
      {c.replies.map((r) => (
        <Comment key={r.id} c={r} now={now} reply />
      ))}
    </article>
  )
}
