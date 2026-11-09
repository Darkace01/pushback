import { graphqlUrl } from '../shared/accounts'
import type { RateLimit } from '../shared/types'

// PUSHBACK_API_URL points the app at a fake GitHub for the end-to-end tests.
const API = process.env.PUSHBACK_API_URL || 'https://api.github.com'

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const MAX_CACHED = 1000

interface Cached {
  etag: string
  data: unknown
}

/**
 * Thin GitHub client. REST GETs use ETag conditional requests: a 304 reply
 * does not count against the rate limit, which is what lets us poll often.
 */
export class GitHub {
  private cache = new Map<string, Cached>()
  /** Identical GETs made at the same moment (several widgets, the poller and a view) share one request. */
  private inflight = new Map<string, Promise<unknown>>()
  /** Set by a spent core budget or a secondary-limit / Retry-After reply: no REST request goes out before this. */
  private restBlockedAt = 0
  rate?: RateLimit
  /** GraphQL has its own hourly budget (points, not requests), separate from REST's `core`. */
  graphqlRate?: RateLimit

  /** `base` is the REST API root: api.github.com by default, or an Enterprise Server's /api/v3. */
  constructor(
    private readonly token: string,
    private readonly base: string = API
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Pushback',
      ...extra
    }
  }

  private trackRate(res: Response): void {
    const resource = res.headers.get('x-ratelimit-resource')
    if (resource !== 'core' && resource !== 'graphql') return
    const limit = Number(res.headers.get('x-ratelimit-limit'))
    const remaining = Number(res.headers.get('x-ratelimit-remaining'))
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    if (Number.isNaN(limit) || !res.headers.has('x-ratelimit-limit')) return
    const rate = { limit, remaining, reset: reset * 1000 }
    if (resource === 'core') this.rate = rate
    else this.graphqlRate = rate
  }

  /** When GraphQL's budget is spent, the time it resets. Until then every query would fail, so we don't send any. */
  graphqlBlockedUntil(now = Date.now()): number | undefined {
    const r = this.graphqlRate
    return r && r.remaining <= 0 && r.reset > now ? r.reset : undefined
  }

  /** When REST is paused (budget spent or GitHub asked us to back off), the time it ends. */
  restBlockedUntil(now = Date.now()): number | undefined {
    const r = this.rate
    const budget = r && r.remaining <= 0 && r.reset > now ? r.reset : 0
    const until = Math.max(budget, this.restBlockedAt)
    return until > now ? until : undefined
  }

  /** Secondary rate limits and abuse detection answer 403/429 with Retry-After (or remaining 0); honour it instead of hammering on. */
  private noteBackoff(res: Response): void {
    if (res.status !== 403 && res.status !== 429) return
    const retry = Number(res.headers.get('retry-after'))
    if (retry > 0) this.restBlockedAt = Date.now() + retry * 1000
    else if (res.headers.get('x-ratelimit-remaining') === '0') this.restBlockedAt = Number(res.headers.get('x-ratelimit-reset')) * 1000
    else if (res.status === 429) this.restBlockedAt = Date.now() + 60_000
  }

  private remember(key: string, entry: Cached): void {
    this.cache.delete(key)
    this.cache.set(key, entry)
    // Bound memory: drop the least recently stored entries.
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string)
  }

  /** `accept` can ask for GitHub's rendered, sanitised HTML of markdown bodies (`application/vnd.github.html+json`). */
  async get<T>(path: string, accept?: string): Promise<T> {
    const key = accept ? `${accept} ${path}` : path
    const pending = this.inflight.get(key)
    if (pending) return pending as Promise<T>
    const request = this.fetchCached<T>(key, path, accept).finally(() => this.inflight.delete(key))
    this.inflight.set(key, request)
    return request
  }

  private async fetchCached<T>(key: string, path: string, accept?: string): Promise<T> {
    const cached = this.cache.get(key)
    const blocked = this.restBlockedUntil()
    // Paused: stale data beats an error, and beats burning the next hour's budget.
    if (blocked) {
      if (cached) return cached.data as T
      throw restLimited(blocked)
    }
    const res = await fetch(this.base + path, {
      headers: this.headers({ ...(accept && { Accept: accept }), ...(cached && { 'If-None-Match': cached.etag }) })
    })
    this.trackRate(res)
    if (res.status === 304 && cached) return cached.data as T
    if (!res.ok) {
      this.noteBackoff(res)
      throw await toError(res)
    }
    const data = await res.json()
    const etag = res.headers.get('etag')
    if (etag) this.remember(key, { etag, data })
    return data as T
  }

  /** GET a plain-text resource (e.g. job logs, which redirect to blob storage, or a README as HTML). */
  async text(path: string, accept?: string): Promise<string> {
    const blocked = this.restBlockedUntil()
    if (blocked) throw restLimited(blocked)
    const res = await fetch(this.base + path, { headers: this.headers(accept ? { Accept: accept } : undefined) })
    this.trackRate(res)
    if (!res.ok) {
      this.noteBackoff(res)
      throw await toError(res)
    }
    return res.text()
  }

  async send(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const blocked = this.restBlockedUntil()
    if (blocked) throw restLimited(blocked)
    const res = await fetch(this.base + path, {
      method,
      headers: this.headers(body ? { 'Content-Type': 'application/json' } : undefined),
      body: body ? JSON.stringify(body) : undefined
    })
    this.trackRate(res)
    if (!res.ok) {
      this.noteBackoff(res)
      throw await toError(res)
    }
    return res.status === 204 ? null : res.json().catch(() => null)
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const json = await this.graphqlRaw<T>(query, variables)
    // Partial data is still useful (e.g. one repo of many was renamed), so only fail with no data.
    if (!json.data) throw new GitHubError(json.errors?.map((e) => e.message).join('; ') ?? 'GraphQL error', 200)
    return json.data
  }

  /**
   * Like `graphql`, but also hands back the errors that came with partial data. A token missing a scope (e.g.
   * `read:project`) gets data with that field nulled plus an INSUFFICIENT_SCOPES error, which callers want to explain.
   */
  async graphqlPartial<T>(query: string, variables: Record<string, unknown>): Promise<{ data?: T; errors: GraphqlError[] }> {
    const json = await this.graphqlRaw<T>(query, variables)
    return { data: json.data, errors: json.errors ?? [] }
  }

  private async graphqlRaw<T>(query: string, variables: Record<string, unknown>): Promise<{ data?: T; errors?: GraphqlError[] }> {
    const blocked = this.graphqlBlockedUntil()
    if (blocked) throw rateLimited(blocked)
    const res = await fetch(graphqlUrl(this.base), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ query, variables })
    })
    this.trackRate(res)
    if (!res.ok) {
      const blockedNow = this.graphqlBlockedUntil()
      throw blockedNow ? rateLimited(blockedNow) : await toError(res)
    }
    const json = (await res.json()) as { data?: T; errors?: GraphqlError[] }
    // GitHub can answer a spent budget with 200 and a RATE_LIMITED error; hold off until the reset it gave (or a minute).
    if (json.errors?.some((e) => e.type === 'RATE_LIMITED')) {
      const reset = this.graphqlRate && this.graphqlRate.reset > Date.now() ? this.graphqlRate.reset : Date.now() + 60_000
      this.graphqlRate = { limit: this.graphqlRate?.limit ?? 5000, remaining: 0, reset }
      throw rateLimited(reset)
    }
    return json
  }
}

export interface GraphqlError {
  message: string
  type?: string
}

/** Status 429 so callers can tell a spent budget from a broken query. */
export function rateLimited(reset: number): GitHubError {
  const at = new Date(reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return new GitHubError(`GitHub's GraphQL limit is used up until ${at}. Pushback carries on by itself then.`, 429)
}

/** Status 429 for REST: the core budget is spent or GitHub asked us to slow down. */
export function restLimited(until: number): GitHubError {
  const at = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return new GitHubError(`GitHub's API limit is used up until ${at}. Pushback carries on by itself then.`, 429)
}

async function toError(res: Response): Promise<GitHubError> {
  let message = `${res.status} ${res.statusText}`
  try {
    // Validation failures (422) put the useful reason in `errors`, e.g. "Can not approve your own pull request".
    const body = (await res.json()) as { message?: string; errors?: (string | { message?: string; code?: string })[] }
    const details = (body.errors ?? []).map((e) => (typeof e === 'string' ? e : (e.message ?? e.code))).filter(Boolean)
    if (body.message) message = `${details.length ? details.join('; ') : body.message} (${res.status})`
  } catch {
    // non-JSON error body
  }
  return new GitHubError(message, res.status)
}
