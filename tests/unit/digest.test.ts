import { describe, expect, it } from 'vitest'
import { dailyDue, dailyEvents, dailyTime, DEFAULT_DIGEST, normalizeDigest, summarize } from '../../src/shared/digest'
import type { AppEvent, EventKind } from '../../src/shared/types'

const at = (h: number, m = 0, day = 5) => new Date(2026, 0, day, h, m)
let seq = 0
const event = (kind: EventKind, repo = 'acme/api', ts = 0): AppEvent => ({ id: String(seq++), ts, repo, kind, title: '', body: '', url: '', read: false })

describe('summarize', () => {
  it('returns nothing for no events', () => {
    expect(summarize([])).toBeNull()
  })

  it('counts each kind, the most urgent first, with singular and plural wording', () => {
    const d = summarize([
      event('run-success'),
      event('run-failure'),
      event('pr-review', 'acme/web'),
      event('run-failure'),
      event('pr-review', 'acme/web'),
      event('run-failure'),
      event('pr-merged')
    ])
    expect(d).toEqual({
      title: 'While you were away: 7 updates across 2 repos',
      body: '3 runs failed, 2 PRs need your review, 1 PR merged, 1 run succeeded.',
      count: 7
    })
  })

  it('names the repo when there is only one, and takes a custom title', () => {
    const d = summarize([event('pr-opened')], 'Your daily digest')
    expect(d?.title).toBe('Your daily digest: 1 update in acme/api')
    expect(d?.body).toBe('1 PR opened.')
  })

  it('counts kinds it has no wording for as other updates instead of dropping them', () => {
    const d = summarize([event('run-failure'), event('another-new' as EventKind), event('something-new' as EventKind)])
    expect(d?.body).toBe('1 run failed, 2 other updates.')
    expect(d?.count).toBe(3)
  })
  it('puts deployments waiting for approval first', () => {
    expect(summarize([event('run-failure'), event('deploy-approval')])?.body).toBe('1 deployment needs your approval, 1 run failed.')
  })
})

describe('daily digest timing', () => {
  const on = { ...DEFAULT_DIGEST, daily: true, dailyAt: '09:00' }

  it('places the time on the current day', () => {
    expect(dailyTime('09:30', at(14))).toBe(at(9, 30).getTime())
    expect(dailyTime('nope', at(14))).toBeNull()
  })

  it('is due once the time has passed and it has not been shown since', () => {
    expect(dailyDue(on, 0, at(8, 59))).toBe(false)
    expect(dailyDue(on, 0, at(9))).toBe(true)
    expect(dailyDue(on, at(9, 0, 4).getTime(), at(15))).toBe(true) // shown yesterday
    expect(dailyDue(on, at(9, 1).getTime(), at(15))).toBe(false) // already shown today
  })

  it('is never due when switched off or the time is invalid', () => {
    expect(dailyDue({ ...on, daily: false }, 0, at(12))).toBe(false)
    expect(dailyDue({ ...on, dailyAt: '25:00' }, 0, at(12))).toBe(false)
  })

  it('covers events since the last digest, at most a day back', () => {
    const now = at(9)
    const hour = 60 * 60 * 1000
    const events = [event('run-failure', 'a/b', now.getTime() - 2 * hour), event('run-failure', 'a/b', now.getTime() - 30 * hour)]
    expect(dailyEvents(events, 0, now)).toEqual([events[0]])
    expect(dailyEvents(events, now.getTime() - hour, now)).toEqual([])
  })
})

describe('normalizeDigest', () => {
  it('fills in defaults for missing or malformed fields', () => {
    expect(normalizeDigest(undefined)).toEqual(DEFAULT_DIGEST)
    expect(normalizeDigest({ afterQuiet: 'yes' as unknown as boolean, daily: true, dailyAt: '7am' })).toEqual({ afterQuiet: false, daily: true, dailyAt: '09:00' })
    expect(normalizeDigest({ afterQuiet: true, daily: false, dailyAt: '18:15' })).toEqual({ afterQuiet: true, daily: false, dailyAt: '18:15' })
  })
})
