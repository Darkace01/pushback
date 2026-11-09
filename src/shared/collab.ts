import type { DiscussionCategory, DiscussionSummary, Milestone } from './types'

// Pure helpers for milestones and discussions, shared by the main process and the renderer.

/** Share of a milestone's issues that are closed, 0–100 (0 for an empty one). */
export function milestoneProgress(m: Pick<Milestone, 'openIssues' | 'closedIssues'>): number {
  const total = m.openIssues + m.closedIssues
  return total ? Math.round((m.closedIssues / total) * 100) : 0
}

/** "due in 3 days", "due today", "overdue by 2 days" or "no due date", for an open milestone. */
export function dueLabel(dueOn: string | null, now = Date.now()): { text: string; overdue: boolean } {
  if (!dueOn) return { text: 'No due date', overdue: false }
  // GitHub stores due dates as a moment on the due day; compare whole days so "today" isn't "overdue" by the afternoon.
  const day = (t: number) => Math.floor(t / 86_400_000)
  const days = day(Date.parse(dueOn)) - day(now)
  if (days === 0) return { text: 'Due today', overdue: false }
  if (days > 0) return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, overdue: false }
  return { text: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, overdue: true }
}

/** Discussions grouped by category, in the repo's category order; empty categories are left out. */
export function byCategory(categories: DiscussionCategory[], discussions: DiscussionSummary[]): { category: DiscussionCategory; discussions: DiscussionSummary[] }[] {
  const known = [...categories]
  for (const d of discussions) if (!known.some((c) => c.id === d.category.id)) known.push(d.category)
  return known.map((category) => ({ category, discussions: discussions.filter((d) => d.category.id === category.id) })).filter((g) => g.discussions.length)
}
