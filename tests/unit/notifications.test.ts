import { describe, expect, it } from 'vitest'
import { markRead, notificationUrl, reasonLabel, toNotification, type GhThread } from '../../src/shared/notifications'

const thread = (type: string, url: string | null, over: Partial<GhThread> = {}): GhThread => ({
  id: '1',
  unread: true,
  reason: 'mention',
  updated_at: '2026-01-01T00:00:00Z',
  subject: { title: 'Something', type, url },
  repository: { full_name: 'acme/api', html_url: 'https://github.com/acme/api' },
  ...over
})

describe('notificationUrl', () => {
  it('turns API links into web pages', () => {
    expect(notificationUrl(thread('PullRequest', 'https://api.github.com/repos/acme/api/pulls/7'))).toBe('https://github.com/acme/api/pull/7')
    expect(notificationUrl(thread('Issue', 'https://api.github.com/repos/acme/api/issues/3'))).toBe('https://github.com/acme/api/issues/3')
    expect(notificationUrl(thread('Commit', 'https://api.github.com/repos/acme/api/commits/abc123'))).toBe('https://github.com/acme/api/commit/abc123')
    expect(notificationUrl(thread('Release', 'https://api.github.com/repos/acme/api/releases/99'))).toBe('https://github.com/acme/api/releases')
    expect(notificationUrl(thread('Discussion', null))).toBe('https://github.com/acme/api/discussions')
    expect(notificationUrl(thread('CheckSuite', null))).toBe('https://github.com/acme/api/actions')
    expect(notificationUrl(thread('RepositoryInvitation', null))).toBe('https://github.com/acme/api')
  })
  it('keeps Enterprise links on their own host', () => {
    const t = thread('PullRequest', 'https://ghe.test/api/v3/repos/corp/tools/pulls/21', { repository: { full_name: 'corp/tools', html_url: 'https://ghe.test/corp/tools' } })
    expect(notificationUrl(t)).toBe('https://ghe.test/corp/tools/pull/21')
  })
})

describe('toNotification', () => {
  it('maps a thread', () => {
    expect(toNotification(thread('PullRequest', 'https://api.github.com/repos/acme/api/pulls/7', { reason: 'review_requested' }))).toEqual({
      id: '1', repo: 'acme/api', title: 'Something', type: 'PullRequest', reason: 'review_requested', unread: true,
      updatedAt: '2026-01-01T00:00:00Z', url: 'https://github.com/acme/api/pull/7'
    })
  })
})

describe('reasonLabel and markRead', () => {
  it('labels known reasons and humanises unknown ones', () => {
    expect(reasonLabel('review_requested')).toBe('Review requested')
    expect(reasonLabel('some_new_reason')).toBe('some new reason')
  })
  it('marks one or all read', () => {
    const list = [toNotification(thread('Issue', null)), { ...toNotification(thread('Issue', null)), id: '2' }]
    expect(markRead(list, '2').map((n) => n.unread)).toEqual([true, false])
    expect(markRead(list).map((n) => n.unread)).toEqual([false, false])
  })
})
