import { buildSearchQuery, type SearchKind } from '../shared/search'
import type { SearchResult } from '../shared/types'
import type { GitHub } from './github'

interface GhSearchItem {
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  repository_url: string
  user: { login: string; avatar_url: string } | null
  created_at: string
  updated_at: string
  comments: number
  draft?: boolean
  labels: { name: string; color: string }[]
  milestone?: { title: string } | null
  pull_request?: { merged_at?: string | null }
}

/**
 * One REST search call per widget refresh. Search has its own, low rate limit (30 a minute), so this is never
 * part of the poll: the renderer asks when a saved-search widget is on screen, a few minutes apart. Repeats of an
 * unchanged search are ETag 304s.
 */
export async function runSearch(gh: GitHub, query: string, kind: SearchKind): Promise<SearchResult> {
  const q = buildSearchQuery(query, kind)
  const data = await gh.get<{ total_count: number; incomplete_results: boolean; items: GhSearchItem[] }>(
    `/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=50`
  )
  return {
    total: data.total_count,
    incomplete: data.incomplete_results,
    items: data.items.map((i) => ({
      repo: i.repository_url.split('/repos/')[1] ?? '',
      number: i.number,
      title: i.title,
      url: i.html_url,
      kind,
      state: i.pull_request?.merged_at ? 'merged' : i.state,
      author: i.user?.login ?? 'ghost',
      authorAvatar: i.user?.avatar_url ?? '',
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      comments: i.comments,
      isDraft: !!i.draft,
      labels: i.labels.map((l) => ({ name: l.name, color: l.color })),
      ...(i.milestone && { milestone: i.milestone.title })
    }))
  }
}
