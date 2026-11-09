// A branch's merge queue: every queued PR in order, with its state and GitHub's estimate of when it merges.
// main/mergeQueue.ts fetches it with one GraphQL query (`repository.mergeQueue(branch:)`); this module maps the
// raw answer. Pure, so it is unit-tested without GitHub.

export interface RawMergeQueueEntry {
  position: number
  state: string
  enqueuedAt: string
  estimatedTimeToMerge: number | null
  solo: boolean | null
  jump: boolean | null
  enqueuer: { login: string } | null
  headCommit: { oid: string } | null
  pullRequest: { number: number; title: string; url: string; author: { login: string; avatarUrl: string } | null } | null
}

export interface RawMergeQueue {
  defaultBranchRef: { name: string } | null
  mergeQueue: {
    url: string
    configuration: { mergeMethod: string | null; mergingStrategy: string | null; maximumEntriesToBuild: number | null } | null
    entries: { totalCount: number; nodes: (RawMergeQueueEntry | null)[] }
  } | null
}

export type QueueEntryState = 'queued' | 'awaiting-checks' | 'mergeable' | 'unmergeable' | 'locked' | 'unknown'

export interface MergeQueueEntry {
  position: number
  state: QueueEntryState
  number: number
  title: string
  url: string
  author: string
  authorAvatar: string
  /** Who added it to the queue (often the author, or whoever clicked "Merge when ready"). */
  enqueuedBy: string | null
  enqueuedAt: string
  etaSeconds: number | null
  /** Merged on its own, not grouped with other entries. */
  solo: boolean
  /** Jumped to the front of the queue. */
  jump: boolean
  headSha: string | null
}

export interface MergeQueue {
  repo: string
  branch: string
  /** False when the branch has no merge queue (no ruleset or protection rule requires one). */
  enabled: boolean
  url?: string
  mergeMethod?: string
  /** ALLGREEN (every entry's checks must pass) or HEADGREEN (only the group's head). */
  strategy?: string
  maxBuilding?: number
  entries: MergeQueueEntry[]
  /** Entries in the queue, which can exceed the ones fetched. */
  total: number
}

const STATES: Record<string, QueueEntryState> = {
  QUEUED: 'queued',
  AWAITING_CHECKS: 'awaiting-checks',
  MERGEABLE: 'mergeable',
  UNMERGEABLE: 'unmergeable',
  LOCKED: 'locked'
}

export const QUEUE_STATE_LABEL: Record<QueueEntryState, string> = {
  queued: 'Queued',
  'awaiting-checks': 'Awaiting checks',
  mergeable: 'Mergeable',
  unmergeable: 'Unmergeable',
  locked: 'Locked',
  unknown: 'Unknown'
}

export function toMergeQueue(repo: string, branch: string | undefined, raw: RawMergeQueue): MergeQueue {
  const name = branch || raw.defaultBranchRef?.name || ''
  const q = raw.mergeQueue
  if (!q) return { repo, branch: name, enabled: false, entries: [], total: 0 }
  const entries = q.entries.nodes
    .filter((e): e is RawMergeQueueEntry => !!e?.pullRequest)
    .map(
      (e): MergeQueueEntry => ({
        position: e.position,
        state: STATES[e.state] ?? 'unknown',
        number: e.pullRequest!.number,
        title: e.pullRequest!.title,
        url: e.pullRequest!.url,
        author: e.pullRequest!.author?.login ?? 'ghost',
        authorAvatar: e.pullRequest!.author?.avatarUrl ?? '',
        enqueuedBy: e.enqueuer?.login ?? null,
        enqueuedAt: e.enqueuedAt,
        etaSeconds: e.estimatedTimeToMerge,
        solo: !!e.solo,
        jump: !!e.jump,
        headSha: e.headCommit?.oid ?? null
      })
    )
    .sort((a, b) => a.position - b.position)
  const c = q.configuration
  return {
    repo,
    branch: name,
    enabled: true,
    url: q.url,
    mergeMethod: c?.mergeMethod ?? undefined,
    strategy: c?.mergingStrategy ?? undefined,
    maxBuilding: c?.maximumEntriesToBuild ?? undefined,
    entries,
    total: Math.max(q.entries.totalCount, entries.length)
  }
}

/** "about 5 min", "about 1 h 20 min", "under a minute"; empty when GitHub has no estimate. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || seconds < 0) return ''
  if (seconds < 60) return 'under a minute'
  const min = Math.round(seconds / 60)
  if (min < 60) return `about ${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return `about ${h} h${rest ? ` ${rest} min` : ''}`
}
