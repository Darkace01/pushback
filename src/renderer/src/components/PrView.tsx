import { useCallback, useEffect, useState } from 'react'
import type { PrDetail, WorkflowRun } from '../../../shared/types'
import { timeAgo, useNow } from '../lib/format'
import { webUrl } from '../lib/hosts'
import { openInApp, openRepo } from '../lib/open'
import { api, toast, useSnapshot } from '../lib/store'
import { closeModal, pushModal } from '../lib/ui'
import { approve } from '../widgets/PrsWidget'
import { Markdown } from './Markdown'
import { MergeStatus } from './MergeStatus'
import { ProjectsPanel } from './Projects'
import { RepoRail } from './RepoRail'
import { ReviewFiles } from './ReviewDiff'
import { Avatar, Empty, Modal, runTone, Segmented, Skeleton, StatusIcon } from './ui'

type Tab = 'conversation' | 'commits' | 'checks' | 'files'

const REVIEW_STATE: Record<string, [string, string]> = {
  APPROVED: ['approved these changes', 'add'],
  CHANGES_REQUESTED: ['requested changes', 'del'],
  COMMENTED: ['reviewed', 'dim'],
  DISMISSED: ['review was dismissed', 'dim']
}

export function PrModal({ repo, number }: { repo: string; number: number }) {
  const snapshot = useSnapshot()
  const now = useNow()
  // The polled summary shows instantly; the full detail loads behind it.
  const summary = snapshot.repos[repo]?.prs.find((p) => p.number === number)
  const [pr, setPr] = useState<PrDetail>()
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState<Tab>('conversation')

  const load = useCallback(
    () =>
      api.prDetail(repo, number).then(
        (d) => (setPr(d), setError(undefined)),
        (e: Error) => setError(e.message)
      ),
    [repo, number]
  )
  useEffect(() => void load(), [load, summary?.updatedAt])

  const title = pr?.title ?? summary?.title ?? `Pull request #${number}`
  const viewer = snapshot.viewer?.login
  const open = pr ? pr.state === 'open' : true
  const failing = pr?.checks.filter((c) => c.conclusion === 'failure').length ?? 0

  return (
    <Modal title={`${repo} #${number}`} onClose={closeModal} panel side={<RepoRail repo={repo} pr={number} />}>
      <div className="pr-head">
        <h1 className="pr-title">
          {title} <span className="dim">#{number}</span>
        </h1>
        <div className="row-meta">
          {pr && <span className={`badge badge-state-${pr.isDraft && open ? 'draft' : pr.state}`}>{pr.isDraft && open ? 'Draft' : pr.state[0].toUpperCase() + pr.state.slice(1)}</span>}
          {pr && (
            <>
              <Avatar src={pr.authorAvatar} login={pr.author} size={16} />
              <span>
                <span className="strong">{pr.author}</span> wants to merge {pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'} into{' '}
                <span className="mono chip">{pr.base}</span> from <span className="mono chip">{pr.head}</span>
              </span>
              <span>{timeAgo(pr.createdAt, now)}</span>
            </>
          )}
          <button className="link" onClick={() => openRepo(repo)}>
            {repo}
          </button>
        </div>
        {pr && pr.labels.length > 0 && (
          <div className="inline">
            {pr.labels.map((l) => (
              <span key={l.name} className="label" style={{ ['--label' as string]: `#${l.color}` }}>
                {l.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="inline">
        {open && pr?.author !== viewer && (
          <button className="btn" onClick={() => void approve({ repo, number }).then(load)}>
            ✓ Approve
          </button>
        )}
        {open && pr?.author !== viewer && (
          <button className="btn" onClick={() => pushModal({ kind: 'review', pr: { repo, number, title, url: pr?.url ?? webUrl(repo, `/pull/${number}`) } })}>
            Review…
          </button>
        )}
        {open && !pr?.isDraft && (
          <button className="btn btn-primary" onClick={() => pushModal({ kind: 'merge', pr: { repo, number, title, url: pr?.url ?? webUrl(repo, `/pull/${number}`) } })}>
            Merge…
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={() => void navigator.clipboard.writeText(webUrl(repo, `/pull/${number}`)).then(() => toast('Link copied', 'ok'))}>
          Copy link
        </button>
        <button className="btn" onClick={() => void api.openExternal(webUrl(repo, `/pull/${number}`))}>
          Open in browser
        </button>
      </div>

      {open && pr && <MergeStatus repo={repo} number={number} refreshKey={summary?.updatedAt} />}
      {pr && <ProjectsPanel repo={repo} number={number} />}

      {error && <p className="del">Couldn't load this pull request: {error}</p>}
      {!pr && !error && <Skeleton kind="text" rows={6} />}
      {pr && (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              ['conversation', `Conversation ${pr.comments.length || ''}`],
              ['commits', `Commits ${pr.commits.length}`],
              ['checks', `Checks ${pr.checks.length}${failing ? ` · ${failing} failing` : ''}`],
              ['files', `Files ${pr.changedFiles} · +${pr.additions} −${pr.deletions}`]
            ]}
          />
          {tab === 'conversation' && <Conversation pr={pr} onChange={load} />}
          {tab === 'commits' && <Commits pr={pr} />}
          {tab === 'checks' && <Checks pr={pr} />}
          {tab === 'files' && <ReviewFiles pr={pr} />}
        </>
      )}
    </Modal>
  )
}

function Conversation({ pr, onChange }: { pr: PrDetail; onChange: () => void }) {
  const now = useNow()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setBusy(true)
    const r = await api.commentPr(pr.repo, pr.number, text.trim())
    setBusy(false)
    if (!r.ok) return toast(`Comment failed: ${r.error}`, 'error')
    setText('')
    onChange()
  }

  return (
    <div className="timeline">
      <article className="comment">
        <header>
          <Avatar src={pr.authorAvatar} login={pr.author} size={20} />
          <span className="strong">{pr.author}</span>
          <span className="dim">opened {timeAgo(pr.createdAt, now)}</span>
        </header>
        <Markdown html={pr.bodyHtml} />
      </article>
      {pr.comments.map((c, i) => {
        const review = c.reviewState ? REVIEW_STATE[c.reviewState] : null
        return (
          <article key={i} className={`comment${review && !c.bodyHtml ? ' comment-event' : ''}`}>
            <header>
              <Avatar src={c.authorAvatar} login={c.author} size={20} />
              <span className="strong">{c.author}</span>
              {review && <span className={review[1]}>{review[0]}</span>}
              <span className="dim">{timeAgo(c.createdAt, now)}</span>
            </header>
            {c.bodyHtml && <Markdown html={c.bodyHtml} />}
          </article>
        )
      })}
      {pr.requestedReviewers.length > 0 && <p className="dim small">Waiting on review from {pr.requestedReviewers.join(', ')}.</p>}
      <div className="comment-box">
        <textarea
          rows={3}
          placeholder="Leave a comment (Markdown supported) — Ctrl+Enter to send"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) void send()
          }}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Comment'}
        </button>
      </div>
    </div>
  )
}

function Commits({ pr }: { pr: PrDetail }) {
  const now = useNow()
  return (
    <ul className="list">
      {pr.commits.map((c) => {
        const [subject, ...body] = c.message.split('\n')
        return (
          <li key={c.sha} className="row clickable" onClick={() => void api.openExternal(webUrl(pr.repo, `/commit/${c.sha}`))} title={body.join('\n').trim() || undefined}>
            <Avatar src={c.authorAvatar ?? ''} login={c.author} size={18} />
            <div className="row-main">
              <div className="row-title">
                <span className="strong">{subject}</span>
              </div>
              <div className="row-meta">
                <span>{c.author}</span>
                <span>{timeAgo(c.date, now)}</span>
              </div>
            </div>
            <span className="mono dim small">{c.sha.slice(0, 7)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Checks({ pr }: { pr: PrDetail }) {
  if (!pr.checks.length) return <Empty>No checks reported for the latest commit.</Empty>
  const order = (c: PrDetail['checks'][number]) => (c.conclusion === 'failure' ? 0 : c.status !== 'completed' ? 1 : 2)
  return (
    <ul className="list">
      {[...pr.checks]
        .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
        .map((c) => (
          <li key={c.url} className="row clickable" onClick={() => openInApp(c.url)}>
            <StatusIcon tone={runTone({ status: c.status as WorkflowRun['status'], conclusion: c.conclusion })} />
            <div className="row-main">
              <span className="strong">{c.name}</span>
            </div>
            <span className="dim small">{c.conclusion ?? c.status.replace('_', ' ')}</span>
          </li>
        ))}
    </ul>
  )
}
