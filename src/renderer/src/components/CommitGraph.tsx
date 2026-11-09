import { memo, useMemo } from 'react'
import type { GraphCommit } from '../../../shared/types'
import { layoutGraph, type Row, type Seg } from '../lib/graph'
import { timeAgo, useNow } from '../lib/format'
import { Avatar } from './ui'

// Lane colours: distinct in both dark and light themes.
const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f778ba', '#a371f7', '#ff7b72', '#39c5cf', '#e3b341']
const LANE = 14
const ROW = 30

const x = (lane: number) => lane * LANE + LANE / 2 + 2
const color = (i: number) => COLORS[i % COLORS.length]

/** The graph cell for one row: lines coming in from above, going out below, and the commit's dot. */
function GraphCell({ row, width }: { row: Row; width: number }) {
  const mid = ROW / 2
  const path = (s: Seg, y1: number, y2: number) =>
    s.from === s.to ? `M${x(s.from)} ${y1}V${y2}` : `M${x(s.from)} ${y1}C${x(s.from)} ${(y1 + y2) / 2} ${x(s.to)} ${(y1 + y2) / 2} ${x(s.to)} ${y2}`
  const merge = row.commit.parents.length > 1
  const head = row.commit.refs.some((r) => r.startsWith('head:'))
  return (
    <svg className="graph-cell" width={width * LANE + 4} height={ROW} aria-hidden>
      {row.up.map((s, i) => (
        <path key={`u${i}`} d={path(s, 0, mid)} stroke={color(s.color)} />
      ))}
      {row.down.map((s, i) => (
        <path key={`d${i}`} d={path(s, mid, ROW)} stroke={color(s.color)} />
      ))}
      {head && <circle cx={x(row.col)} cy={mid} r={7} fill="none" stroke={color(row.color)} strokeWidth={1.5} />}
      <circle cx={x(row.col)} cy={mid} r={merge ? 3.5 : 4.5} fill={merge ? 'var(--bg)' : color(row.color)} stroke={color(row.color)} strokeWidth={merge ? 2 : 0} />
    </svg>
  )
}

/** Branch, remote and tag labels for a commit. */
export function RefChips({ refs }: { refs: string[] }) {
  return (
    <>
      {refs.map((r) => {
        const [kind, name] = [r.slice(0, r.indexOf(':')), r.slice(r.indexOf(':') + 1)]
        return (
          <span key={r} className={`ref-chip ref-${kind}`} title={{ head: 'Checked out', branch: 'Branch', remote: 'Remote branch', tag: 'Tag' }[kind]}>
            {kind === 'tag' ? '◆ ' : kind === 'remote' ? '☁ ' : kind === 'head' ? '⎇ ' : ''}
            {name}
          </span>
        )
      })}
    </>
  )
}

/** A commit list with the branch graph drawn alongside: lanes, merges and branch/tag labels. */
export const CommitGraph = memo(function CommitGraph({ commits, selected, onSelect, highlight, graph = true }: {
  commits: GraphCommit[]
  selected?: string
  onSelect?: (c: GraphCommit) => void
  /** SHAs to emphasise (search matches); the rest are dimmed. */
  highlight?: Set<string>
  /** Plain list without lanes (search results, file history), where commits aren't one continuous history. */
  graph?: boolean
}) {
  const now = useNow()
  const { rows, width } = useMemo(() => layoutGraph(commits), [commits])
  return (
    <div className="commit-graph" role="list">
      {rows.map((row) => {
        const c = row.commit
        return (
          <div
            key={c.sha}
            role="listitem"
            className={`graph-row${selected === c.sha ? ' on' : ''}${highlight && !highlight.has(c.sha) ? ' faded' : ''}${onSelect ? ' clickable' : ''}`}
            onClick={() => onSelect?.(c)}
          >
            {graph ? <GraphCell row={row} width={width} /> : <span className="graph-dot" style={{ background: color(row.color) }} />}
            <span className="graph-subject">
              <RefChips refs={c.refs} />
              <span className="graph-text" title={c.subject}>
                {c.subject}
              </span>
            </span>
            <span className="graph-author" title={c.email ?? c.author}>
              {c.avatar && <Avatar src={c.avatar} login={c.author} size={16} />}
              <span className="graph-author-name">{c.author}</span>
            </span>
            <span className="graph-date" title={new Date(c.date).toLocaleString()}>
              {timeAgo(c.date, now)}
            </span>
            <span className="graph-sha mono">{c.sha.slice(0, 7)}</span>
          </div>
        )
      })}
    </div>
  )
})

/** A unified diff, starting at the first hunk (the header lines repeat the file name shown above it). */
export function DiffView({ text }: { text?: string }) {
  if (text === undefined) return null
  const lines = text.split('\n')
  const body = lines.slice(Math.max(0, lines.findIndex((l) => l.startsWith('@@'))))
  if (!text.trim()) return <p className="dim small">No changes to show (binary file or mode change only).</p>
  return (
    <pre className="diff">
      {body.map((l, i) => (
        <div key={i} className={l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'ins' : l.startsWith('-') ? 'rem' : undefined}>
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}
