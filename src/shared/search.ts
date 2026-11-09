import type { SavedSearch, SearchItem } from './types'

// Saved searches: GitHub issue/PR search queries that run across every repo and org you can see, shown as a widget.

export type SearchKind = 'pr' | 'issue'

/** Ready-made searches offered when pinning, so the common ones are a click away. */
export const SEARCH_PRESETS: SavedSearch[] = [
  { id: 'preset-my-prs', name: 'My open PRs', kind: 'pr', query: 'is:open author:@me archived:false' },
  { id: 'preset-review', name: 'Awaiting my review', kind: 'pr', query: 'is:open review-requested:@me archived:false' },
  { id: 'preset-involved', name: "PRs I'm involved in", kind: 'pr', query: 'is:open involves:@me -author:@me archived:false' },
  { id: 'preset-assigned', name: 'Issues assigned to me', kind: 'issue', query: 'is:open assignee:@me archived:false' },
  { id: 'preset-mentioned', name: 'Issues mentioning me', kind: 'issue', query: 'is:open mentions:@me archived:false' }
]

const MAX_QUERY = 256

/**
 * The query actually sent: the user's text plus the type qualifier. Any `is:pr` / `is:issue` / `type:` they typed
 * is replaced, so the widget's kind setting always wins and the search can't mix the two.
 */
export function buildSearchQuery(query: string, kind: SearchKind): string {
  const text = query
    .replace(/\b(is|type):(pr|issue|pull-request)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) throw new Error('Enter a search, for example: is:open author:@me')
  if (text.length > MAX_QUERY) throw new Error(`Searches can be at most ${MAX_QUERY} characters`)
  return `${text} is:${kind}`
}

/** What the widget's filter options do to a result list (all client-side, so changing them costs no requests). */
export function filterSearchItems(
  items: SearchItem[],
  o: { author?: unknown; label?: unknown; repo?: unknown; hideDrafts?: unknown; milestone?: unknown },
  matches: (hay: string, q: string) => boolean
): SearchItem[] {
  let out = items
  if (o.hideDrafts) out = out.filter((i) => !i.isDraft)
  if (o.author) out = out.filter((i) => matches(i.author, String(o.author)))
  if (o.repo) out = out.filter((i) => matches(i.repo, String(o.repo)))
  if (o.label) out = out.filter((i) => i.labels.some((l) => matches(l.name, String(o.label))))
  if (o.milestone) out = out.filter((i) => !!i.milestone && matches(i.milestone, String(o.milestone)))
  return out
}

/** Settings loaded from disk may be hand-edited or from another version: keep only well-formed searches. */
export function cleanSavedSearches(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: SavedSearch[] = []
  for (const s of value as Partial<SavedSearch>[]) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.query !== 'string' || seen.has(s.id)) continue
    seen.add(s.id)
    out.push({ id: s.id, name: s.name.slice(0, 60) || 'Search', query: s.query.slice(0, MAX_QUERY), kind: s.kind === 'issue' ? 'issue' : 'pr' })
  }
  return out
}
