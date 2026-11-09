import { describe, expect, it } from 'vitest'
import { canApprove, environmentNames, newApprovalsForYou, toApproval, type GhPendingDeployment } from '../../src/shared/approvals'
import { attentionCount } from '../../src/shared/attention'
import type { PendingApproval, WorkflowRun } from '../../src/shared/types'

const run = (id: number): WorkflowRun => ({
  repo: 'acme/api', id, workflowId: 2, name: 'Deploy', title: 'Deploy', status: 'waiting', conclusion: null, event: 'push', branch: 'main',
  sha: 'a', actor: 'alice', actorAvatar: '', runNumber: id, attempt: 1, createdAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:01:00Z', url: `https://github.com/acme/api/actions/runs/${id}`
})

const pending = (name: string, mine: boolean): GhPendingDeployment => ({
  environment: { id: name.length, name, html_url: `https://github.com/acme/api/deployments/${name}` },
  wait_timer: 0,
  current_user_can_approve: mine,
  reviewers: [{ type: 'User', reviewer: { login: 'octo' } }, { type: 'Team', reviewer: { slug: 'release' } }]
})

describe('toApproval', () => {
  it('maps the environments, reviewers and whether you can approve', () => {
    const a = toApproval(run(5), [pending('prod-acme', true), pending('dev', false)])!
    expect(a).toMatchObject({ repo: 'acme/api', runId: 5, runName: 'Deploy', branch: 'main', actor: 'alice', since: '2026-01-01T00:01:00Z' })
    expect(a.environments).toEqual([
      { id: 9, name: 'prod-acme', url: 'https://github.com/acme/api/deployments/prod-acme', waitTimer: 0, canApprove: true, reviewers: ['octo', 'release'] },
      { id: 3, name: 'dev', url: 'https://github.com/acme/api/deployments/dev', waitTimer: 0, canApprove: false, reviewers: ['octo', 'release'] }
    ])
    expect(canApprove(a)).toBe(true)
    expect(environmentNames(a)).toBe('prod-acme, dev')
  })
  it('is null when nothing is pending any more', () => {
    expect(toApproval(run(5), [])).toBeNull()
  })
  it('skips reviewers GitHub no longer resolves', () => {
    const p = { ...pending('dev', false), reviewers: [{ type: 'User' as const, reviewer: null }] }
    expect(toApproval(run(1), [p])!.environments[0].reviewers).toEqual([])
  })
})

describe('newApprovalsForYou', () => {
  const a = (id: number, mine: boolean) => toApproval(run(id), [pending('prod', mine)]) as PendingApproval
  it('returns approvals you can give that you have not been told about', () => {
    expect(newApprovalsForYou([a(1, true)], [a(1, true), a(2, true), a(3, false)]).map((x) => x.runId)).toEqual([2])
  })
  it('treats a first poll as all new', () => {
    expect(newApprovalsForYou(undefined, [a(1, true)]).map((x) => x.runId)).toEqual([1])
  })
  it('notifies again when you become a reviewer of a run you could not approve before', () => {
    expect(newApprovalsForYou([a(1, false)], [a(1, true)]).map((x) => x.runId)).toEqual([1])
  })
})

describe('attentionCount with approvals', () => {
  const mine = toApproval(run(1), [pending('prod', true)])!
  const others = toApproval(run(2), [pending('prod', false)])!
  it('counts approvals waiting on you once, and not ones for other reviewers', () => {
    const unreadEvent = { id: 'e', ts: 0, repo: 'acme/api', kind: 'deploy-approval' as const, title: '', body: '', url: mine.runUrl, read: false }
    expect(attentionCount({ events: [], approvals: [mine, others] })).toBe(1)
    expect(attentionCount({ events: [unreadEvent], approvals: [mine] })).toBe(1)
  })
})
