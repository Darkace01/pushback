import type { GhNotification } from './types'

/** One thread from GET /notifications. */
export interface GhThread {
  id: string
  unread: boolean
  reason: string
  updated_at: string
  subject: { title: string; type: string; url: string | null; latest_comment_url?: string | null }
  repository: { full_name: string; html_url: string }
}

/**
 * The web page a notification is about. The API gives an API URL (or none, for discussions), so it is rebuilt
 * on the repo's own web URL, which keeps GitHub Enterprise links on their host.
 */
export function notificationUrl(t: GhThread): string {
  const base = t.repository.html_url.replace(/\/$/, '')
  const api = t.subject.url ?? ''
  let m: RegExpMatchArray | null
  if ((m = api.match(/\/pulls\/(\d+)$/))) return `${base}/pull/${m[1]}`
  if ((m = api.match(/\/issues\/(\d+)$/))) return `${base}/issues/${m[1]}`
  if ((m = api.match(/\/commits\/([0-9a-f]+)$/))) return `${base}/commit/${m[1]}`
  if ((m = api.match(/\/discussions\/(\d+)$/))) return `${base}/discussions/${m[1]}`
  if (t.subject.type === 'Release') return `${base}/releases`
  if (t.subject.type === 'Discussion') return `${base}/discussions`
  if (t.subject.type === 'CheckSuite' || t.subject.type === 'WorkflowRun') return `${base}/actions`
  return base
}

export function toNotification(t: GhThread): GhNotification {
  return {
    id: String(t.id),
    repo: t.repository.full_name,
    title: t.subject.title,
    type: t.subject.type,
    reason: t.reason,
    unread: t.unread,
    updatedAt: t.updated_at,
    url: notificationUrl(t)
  }
}

const REASONS: Record<string, string> = {
  review_requested: 'Review requested',
  mention: 'Mentioned',
  team_mention: 'Team mentioned',
  author: 'Your thread',
  comment: 'Commented',
  assign: 'Assigned',
  state_change: 'State changed',
  ci_activity: 'CI',
  subscribed: 'Watching',
  manual: 'Subscribed',
  security_alert: 'Security alert',
  invitation: 'Invitation',
  approval_requested: 'Approval requested',
  member_feature_requested: 'Feature request'
}

/** A short label for why you were notified. */
export const reasonLabel = (reason: string): string => REASONS[reason] ?? reason.replace(/_/g, ' ')

/** Marks threads read locally, so the list updates before the next poll. No id: all of them. */
export function markRead(list: GhNotification[], id?: string): GhNotification[] {
  return list.map((n) => (!id || n.id === id ? { ...n, unread: false } : n))
}
