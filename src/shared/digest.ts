// Notification digests: one summary toast instead of the toasts that quiet hours or a snooze held back, and an
// optional once-a-day roundup. Pure, so the counting, wording and timing are unit-tested without Electron.

import { parseClock } from './notifyRules'
import type { AppEvent, DigestSettings, EventKind } from './types'

export const DEFAULT_DIGEST: DigestSettings = { afterQuiet: false, daily: false, dailyAt: '09:00' }

/** How each kind of event is counted, as [singular, plural] phrases, in the order they're listed. */
const PHRASES: [EventKind, string, string][] = [
  ['deploy-approval', 'deployment needs your approval', 'deployments need your approval'],
  ['run-failure', 'run failed', 'runs failed'],
  ['pr-checks-failed', 'PR has failing checks', 'PRs have failing checks'],
  ['pr-review', 'PR needs your review', 'PRs need your review'],
  ['pr-ready', 'PR is ready for review', 'PRs are ready for review'],
  ['pr-opened', 'PR opened', 'PRs opened'],
  ['pr-merged', 'PR merged', 'PRs merged'],
  ['pr-closed', 'PR closed', 'PRs closed'],
  ['run-success', 'run succeeded', 'runs succeeded'],
  ['run-cancelled', 'run cancelled', 'runs cancelled'],
  ['run-started', 'run started', 'runs started']
]

export interface Digest {
  title: string
  body: string
  /** Events summarised. */
  count: number
}

/**
 * Summarises events into one notification: "While you were away" + "3 runs failed, 2 PRs need your review…".
 * Kinds it has no phrase for (added later) are counted as "other updates" rather than dropped. Null when there's nothing.
 */
export function summarize(events: AppEvent[], title = 'While you were away'): Digest | null {
  if (!events.length) return null
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  const parts: string[] = []
  for (const [kind, one, many] of PHRASES) {
    const n = counts.get(kind)
    if (!n) continue
    parts.push(`${n} ${n === 1 ? one : many}`)
    counts.delete(kind)
  }
  const other = [...counts.values()].reduce((a, b) => a + b, 0)
  if (other) parts.push(`${other} other update${other === 1 ? '' : 's'}`)
  const repos = new Set(events.map((e) => e.repo))
  const where = repos.size === 1 ? ` in ${[...repos][0]}` : ` across ${repos.size} repos`
  return { title: `${title}: ${events.length} update${events.length === 1 ? '' : 's'}${where}`, body: `${parts.join(', ')}.`, count: events.length }
}

/** Today's daily-digest time as epoch ms, or null if the time isn't a valid HH:MM. */
export function dailyTime(at: string, now: Date): number | null {
  const minutes = parseClock(at)
  if (minutes === null) return null
  const t = new Date(now)
  t.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return t.getTime()
}

/**
 * Whether the daily digest is due: it's on, today's time has passed, and it hasn't been shown since then.
 * If the computer was off at that time, it shows when Pushback next runs that day.
 */
export function dailyDue(digest: DigestSettings, lastDaily: number, now: Date): boolean {
  if (!digest.daily) return false
  const at = dailyTime(digest.dailyAt, now)
  return at !== null && now.getTime() >= at && lastDaily < at
}

/** The events a daily digest covers: everything since the last one, but never more than a day. */
export function dailyEvents(events: AppEvent[], lastDaily: number, now: Date): AppEvent[] {
  const since = Math.max(lastDaily, now.getTime() - 24 * 60 * 60 * 1000)
  return events.filter((e) => e.ts > since)
}

/** Fills in anything missing or malformed from an older or hand-edited settings file. */
export function normalizeDigest(raw: Partial<DigestSettings> | undefined): DigestSettings {
  return {
    afterQuiet: raw?.afterQuiet === true,
    daily: raw?.daily === true,
    dailyAt: typeof raw?.dailyAt === 'string' && parseClock(raw.dailyAt) !== null ? raw.dailyAt : DEFAULT_DIGEST.dailyAt
  }
}
