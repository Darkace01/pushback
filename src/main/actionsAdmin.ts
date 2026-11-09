import sodium from 'libsodium-wrappers'
import { actionsNameError } from '../shared/actionsAdmin'
import type { ActionResult, ActionsAdminAction, ActionsAdminAnswer, ActionsAdminKind, ActionsCache, ActionsCaches, ActionsList, ActionsRunner, ActionsSecret, ActionsVariable } from '../shared/types'
import { GitHubError, type GitHub } from './github'

// A repo's Actions settings: secrets (names only, values are write-only), variables, self-hosted runners and caches.
// Fetched only while the section is open, never by the poller. Most of these need admin (or a fine-grained
// permission) on the repo, so a 403/404 is normal and shows as "unavailable" instead of an error.

interface GhSecret {
  name: string
  created_at: string
  updated_at: string
}

interface GhVariable extends GhSecret {
  value: string
}

interface GhRunner {
  id: number
  name: string
  os: string
  status: string
  busy: boolean
  labels: { name: string }[]
}

interface GhCache {
  id: number
  key: string
  ref: string
  size_in_bytes: number
  last_accessed_at: string
  created_at: string
}

export const mapSecrets = (items: GhSecret[]): ActionsSecret[] => items.map((s) => ({ name: s.name, createdAt: s.created_at, updatedAt: s.updated_at }))

export const mapVariables = (items: GhVariable[]): ActionsVariable[] =>
  items.map((v) => ({ name: v.name, value: v.value, createdAt: v.created_at, updatedAt: v.updated_at }))

export const mapRunners = (items: GhRunner[]): ActionsRunner[] =>
  items.map((r) => ({ id: r.id, name: r.name, os: r.os, status: r.status === 'online' ? 'online' : 'offline', busy: r.busy, labels: r.labels.map((l) => l.name) }))

export const mapCaches = (items: GhCache[]): ActionsCache[] =>
  items.map((c) => ({ id: c.id, key: c.key, ref: c.ref, size: c.size_in_bytes, lastUsedAt: c.last_accessed_at, createdAt: c.created_at }))

/** What each list needs, for the message shown when the token can't read it. */
const NEEDS: Record<ActionsAdminKind, string> = {
  secrets: 'admin access to the repo (a fine-grained token needs the Secrets permission)',
  variables: 'admin access to the repo (a fine-grained token needs the Variables permission)',
  runners: 'admin access to the repo (a fine-grained token needs the Administration permission)',
  caches: 'the repo scope (a fine-grained token needs the Actions permission)'
}

export function unavailableReason(kind: ActionsAdminKind, err: unknown): string | undefined {
  if (!(err instanceof GitHubError) || (err.status !== 403 && err.status !== 404)) return undefined
  return `GitHub won't show this repo's ${kind} to this token. It needs ${NEEDS[kind]}.`
}

/** Pages through a `{ total_count, <field>: [] }` list, stopping after `maxPages`. */
async function pages<T>(gh: GitHub, path: string, field: string, perPage: number, maxPages: number): Promise<{ items: T[]; total: number }> {
  const items: T[] = []
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const res = await gh.get<Record<string, unknown> & { total_count: number }>(`${path}${sep}per_page=${perPage}&page=${page}`)
    const batch = (res[field] ?? []) as T[]
    items.push(...batch)
    total = res.total_count
    if (batch.length < perPage || items.length >= total) break
  }
  return { items, total }
}

async function listed<T, G>(kind: ActionsAdminKind, load: () => Promise<{ items: G[]; total: number }>, map: (g: G[]) => T[]): Promise<ActionsList<T>> {
  try {
    const { items, total } = await load()
    return { items: map(items), total }
  } catch (err) {
    const unavailable = unavailableReason(kind, err)
    if (!unavailable) throw err
    return { items: [], total: 0, unavailable }
  }
}

async function listCaches(gh: GitHub, repo: string): Promise<ActionsCaches> {
  const list = await listed('caches', () => pages<GhCache>(gh, `/repos/${repo}/actions/caches?sort=last_accessed_at&direction=desc`, 'actions_caches', 100, 3), mapCaches)
  if (list.unavailable) return { ...list, usageBytes: 0, usageCount: 0 }
  // The list may be cut short; the usage endpoint has the true totals.
  const usage = await gh
    .get<{ active_caches_size_in_bytes: number; active_caches_count: number }>(`/repos/${repo}/actions/cache/usage`)
    .catch(() => ({ active_caches_size_in_bytes: list.items.reduce((n, c) => n + c.size, 0), active_caches_count: list.total }))
  return { ...list, usageBytes: usage.active_caches_size_in_bytes, usageCount: usage.active_caches_count }
}

export async function actionsAdmin<K extends ActionsAdminKind>(gh: GitHub, repo: string, kind: K): Promise<ActionsAdminAnswer[K]> {
  const answer = async (): Promise<ActionsAdminAnswer[ActionsAdminKind]> => {
    switch (kind) {
      case 'secrets':
        return listed('secrets', () => pages<GhSecret>(gh, `/repos/${repo}/actions/secrets`, 'secrets', 100, 3), mapSecrets)
      case 'variables':
        // GitHub caps variables at 30 a page.
        return listed('variables', () => pages<GhVariable>(gh, `/repos/${repo}/actions/variables`, 'variables', 30, 5), mapVariables)
      case 'runners':
        return listed('runners', () => pages<GhRunner>(gh, `/repos/${repo}/actions/runners`, 'runners', 100, 2), mapRunners)
      case 'caches':
        return listCaches(gh, repo)
      default:
        throw new Error(`Unknown Actions list: ${String(kind)}`)
    }
  }
  return (await answer()) as ActionsAdminAnswer[K]
}

/**
 * Encrypts a secret for GitHub: a libsodium sealed box to the repo's public key (both base64), as GitHub requires.
 * Only the repo's private key, which GitHub holds, can open it.
 */
export async function sealSecret(value: string, publicKeyBase64: string): Promise<string> {
  await sodium.ready
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL)
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), key)
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL)
}

function checkName(name: unknown): string {
  const error = typeof name === 'string' ? actionsNameError(name) : 'Enter a name'
  if (error) throw new Error(error)
  return name as string
}

function checkRef(ref: unknown): string {
  // eslint-disable-next-line no-control-regex
  if (typeof ref !== 'string' || !ref || ref.length > 255 || /[\u0000-\u001f\s]/.test(ref)) throw new Error('Not a ref')
  return ref
}

/** Deletes every cache made by one ref, one by one: GitHub's bulk delete needs the exact cache key as well. */
async function deleteCachesForRef(gh: GitHub, repo: string, ref: string): Promise<ActionResult> {
  const { items } = await pages<GhCache>(gh, `/repos/${repo}/actions/caches?ref=${encodeURIComponent(ref)}`, 'actions_caches', 100, 10)
  const results = await Promise.allSettled(items.map((c) => gh.send('DELETE', `/repos/${repo}/actions/caches/${c.id}`)))
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  const deleted = results.length - failed.length
  if (failed.length) return { ok: false, number: deleted, error: `Deleted ${deleted} of ${results.length} caches: ${(failed[0].reason as Error).message}` }
  return { ok: true, number: deleted }
}

export async function actionsAdminAct(gh: GitHub, repo: string, action: ActionsAdminAction): Promise<ActionResult> {
  switch (action.kind) {
    case 'set-secret': {
      const name = checkName(action.name)
      if (typeof action.value !== 'string') throw new Error('Enter a value')
      const key = await gh.get<{ key_id: string; key: string }>(`/repos/${repo}/actions/secrets/public-key`)
      await gh.send('PUT', `/repos/${repo}/actions/secrets/${name}`, { encrypted_value: await sealSecret(action.value, key.key), key_id: key.key_id })
      return { ok: true }
    }
    case 'delete-secret':
      await gh.send('DELETE', `/repos/${repo}/actions/secrets/${checkName(action.name)}`)
      return { ok: true }
    case 'set-variable': {
      const name = checkName(action.name)
      const value = String(action.value ?? '')
      if (action.existing) await gh.send('PATCH', `/repos/${repo}/actions/variables/${checkName(action.existing)}`, { name, value })
      else await gh.send('POST', `/repos/${repo}/actions/variables`, { name, value })
      return { ok: true }
    }
    case 'delete-variable':
      await gh.send('DELETE', `/repos/${repo}/actions/variables/${checkName(action.name)}`)
      return { ok: true }
    case 'delete-cache': {
      if (!Number.isSafeInteger(action.id) || action.id <= 0) throw new Error('Not a cache id')
      await gh.send('DELETE', `/repos/${repo}/actions/caches/${action.id}`)
      return { ok: true }
    }
    case 'delete-caches-for-ref':
      return deleteCachesForRef(gh, repo, checkRef(action.ref))
    default:
      throw new Error('Unknown Actions settings change')
  }
}
