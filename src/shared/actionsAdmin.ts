import type { ActionsCache } from './types'

// Pure helpers for the repo's Actions settings section, shared by the main process (which validates before
// anything reaches a URL) and the renderer (which explains a bad name before you submit).

/** GitHub's rules for secret and variable names, as a sentence to show; undefined when the name is fine. */
export function actionsNameError(name: string): string | undefined {
  if (!name) return 'Enter a name'
  if (name.length > 255) return 'Names can be at most 255 characters'
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Use only letters, digits and underscores'
  if (/^[0-9]/.test(name)) return "Names can't start with a digit"
  if (/^GITHUB_/i.test(name)) return "Names can't start with GITHUB_"
  return undefined
}

export interface RefCaches {
  ref: string
  count: number
  size: number
}

/** Caches grouped by the ref that made them, biggest first: the targets for "delete all caches for this ref". */
export function cachesByRef(caches: ActionsCache[]): RefCaches[] {
  const byRef = new Map<string, RefCaches>()
  for (const c of caches) {
    const r = byRef.get(c.ref) ?? { ref: c.ref, count: 0, size: 0 }
    r.count++
    r.size += c.size
    byRef.set(c.ref, r)
  }
  return [...byRef.values()].sort((a, b) => b.size - a.size || a.ref.localeCompare(b.ref))
}

/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let u = 0
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024
    u++
  }
  return `${u === 0 ? n : n.toFixed(n >= 10 ? 0 : 1)} ${units[u]}`
}
