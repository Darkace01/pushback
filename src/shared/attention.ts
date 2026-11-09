import { canApprove } from './approvals'
import type { Snapshot } from './types'

/**
 * What the tray badge counts: things that want you. Unread activity, plus review requests and your own PRs
 * that are failing or have changes requested (those can be quiet for a long time with no new event), and
 * deployments waiting for your approval.
 * Items already covered by an unread event aren't counted twice.
 */
export function attentionCount(snapshot: Pick<Snapshot, 'events' | 'inbox'> & Partial<Pick<Snapshot, 'approvals'>>): number {
  const seen = new Set<string>()
  let n = 0
  for (const e of snapshot.events) {
    if (e.read) continue
    seen.add(e.url)
    n++
  }
  for (const i of snapshot.inbox?.reviewRequests ?? []) if (!seen.has(i.url)) (seen.add(i.url), n++)
  for (const i of snapshot.inbox?.myPrs ?? []) {
    if (seen.has(i.url)) continue
    if (i.checks === 'FAILURE' || i.checks === 'ERROR' || i.reviewDecision === 'CHANGES_REQUESTED') (seen.add(i.url), n++)
  }
  for (const a of snapshot.approvals ?? []) if (canApprove(a) && !seen.has(a.runUrl)) (seen.add(a.runUrl), n++)
  return n
}

/** "12" for the badge, capped so it fits: 99+ . Empty when there is nothing. */
export function badgeText(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : String(count)
}
