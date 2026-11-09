import { useCallback, useEffect, useState } from 'react'
import type { PrReviewers, ReviewerSuggestion } from '../../../shared/types'
import { api, toast } from '../lib/store'
import { Avatar, IconButton, StatusIcon } from './ui'

const STATE: Record<string, [string, 'ok' | 'bad' | 'muted']> = {
  APPROVED: ['approved', 'ok'],
  CHANGES_REQUESTED: ['requested changes', 'bad'],
  COMMENTED: ['commented', 'muted'],
  DISMISSED: ['review dismissed', 'muted']
}

const REASON: Record<ReviewerSuggestion['reason'], string> = { owner: 'Code owner', recent: 'Recent reviewer', collaborator: 'Collaborator' }

/** Who has reviewed and who is requested on a PR, with a picker that suggests code owners and recent reviewers. */
export function Reviewers({ repo, number, refreshKey }: { repo: string; number: number; refreshKey?: string }) {
  const [data, setData] = useState<PrReviewers>()
  const [error, setError] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      api.prReviewers(repo, number).then(
        (d) => (setData(d), setError(undefined)),
        (e: Error) => setError(e.message)
      ),
    [repo, number]
  )
  useEffect(() => void load(), [load, refreshKey])

  const change = async (names: string[], remove: boolean) => {
    setBusy(true)
    const r = await api.requestReviewers(repo, number, names, remove)
    setBusy(false)
    if (!r.ok) return toast(`${remove ? 'Removing' : 'Requesting'} a reviewer failed: ${r.error}`, 'error')
    toast(remove ? `Removed ${names.join(', ')}` : `Requested a review from ${names.join(', ')}`, 'ok')
    setQuery('')
    void load()
  }

  if (error) return <p className="dim small">Reviewers unavailable: {error}</p>
  if (!data) return null
  const q = query.trim().replace(/^@/, '').toLowerCase()
  const shown = data.suggestions.filter((s) => !q || s.login.toLowerCase().includes(q))
  // Anyone can be typed in, not only the suggestions: GitHub says if they can't review.
  const typed = q && !data.suggestions.some((s) => s.login.toLowerCase() === q) ? query.trim().replace(/^@/, '') : null

  return (
    <section className="reviewers" aria-label="Reviewers">
      <div className="reviewer-list">
        <span className="strong">Reviewers</span>
        {data.reviewed.map((r) => {
          const [text, tone] = STATE[r.state] ?? [r.state.toLowerCase().replace('_', ' '), 'muted']
          return (
            <span key={r.login} className="reviewer" title={`${r.login} ${text}`}>
              <StatusIcon tone={tone} />
              <Avatar src={r.avatar} login={r.login} size={16} />
              {r.login} <span className="dim small">{text}</span>
            </span>
          )
        })}
        {data.requested.map((r) => (
          <span key={r.login} className="reviewer" title={`Waiting on ${r.login}`}>
            <StatusIcon tone="warn" />
            {r.login} <span className="dim small">requested</span>
            <IconButton icon="close" title={`Remove ${r.login}`} disabled={busy} onClick={() => void change([r.login], true)} />
          </span>
        ))}
        {!data.reviewed.length && !data.requested.length && <span className="dim small">No reviews yet.</span>}
        <span className="spacer" />
        <button className="btn btn-sm" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          Request review
        </button>
      </div>
      {picking && (
        <div className="reviewer-picker">
          <input
            autoFocus
            placeholder="Search people or type a login (org/team for a team)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (typed || shown[0])) void change([typed ?? shown[0].login], false)
            }}
          />
          <ul className="list">
            {typed && (
              <li className="row clickable" onClick={() => void change([typed], false)}>
                <div className="row-main">
                  <span className="strong">Request {typed}</span>
                </div>
              </li>
            )}
            {shown.map((s) => (
              <li key={s.login} className="row clickable" aria-label={`Request ${s.login}`} onClick={() => !busy && void change([s.login], false)}>
                {!s.team && <Avatar src="" login={s.login} size={18} />}
                <div className="row-main">
                  <div className="row-title">
                    <span className="strong">{s.login}</span>
                    {s.team && <span className="dim"> · team</span>}
                  </div>
                  <div className="row-meta">{s.detail}</div>
                </div>
                <span className={`badge${s.reason === 'owner' ? '' : ' badge-muted'}`}>{REASON[s.reason]}</span>
              </li>
            ))}
            {!shown.length && !typed && <li className="dim small">No suggestions{data.codeowners ? '' : ' (this repo has no CODEOWNERS file)'}.</li>}
          </ul>
          {data.codeowners && <p className="dim small">Code owners come from {data.codeowners}.</p>}
        </div>
      )}
    </section>
  )
}
