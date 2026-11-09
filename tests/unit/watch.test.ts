import { describe, expect, it } from 'vitest'
import { currentStep, elapsed, justFinished, outcome, trayLabel } from '../../src/shared/watch'
import type { WorkflowRun } from '../../src/shared/types'

const job = (name: string, status: string, steps: [string, string][] = []) => ({ name, status, steps: steps.map(([n, s]) => ({ name: n, status: s })) })

describe('currentStep', () => {
  it('finds the job in progress and its unfinished step', () => {
    const jobs = [job('lint', 'completed', [['Run', 'completed']]), job('test', 'in_progress', [['Checkout', 'completed'], ['Test', 'in_progress'], ['Upload', 'queued']])]
    expect(currentStep(jobs)).toEqual({ job: 'test', step: 'Test' })
  })
  it('falls back to a queued job, then to nothing', () => {
    expect(currentStep([job('deploy', 'queued')])).toEqual({ job: 'deploy', step: null })
    expect(currentStep([job('a', 'completed')])).toEqual({ job: null, step: null })
  })
})

describe('run state', () => {
  it('spots the moment a run finishes, once', () => {
    expect(justFinished({ status: 'in_progress' }, { status: 'completed' })).toBe(true)
    expect(justFinished({ status: 'completed' }, { status: 'completed' })).toBe(false)
    expect(justFinished(undefined, { status: 'completed' })).toBe(false)
  })
  it('says how it went in a word', () => {
    expect(outcome({ status: 'in_progress', conclusion: null })).toBe('running')
    expect(outcome({ status: 'queued', conclusion: null })).toBe('queued')
    expect(outcome({ status: 'completed', conclusion: 'success' })).toBe('succeeded')
    expect(outcome({ status: 'completed', conclusion: 'failure' })).toBe('failed')
    expect(outcome({ status: 'completed', conclusion: 'cancelled' })).toBe('cancelled')
  })
  it('labels a run for the tray, with elapsed time up to when it finished', () => {
    const start = '2026-01-05T10:00:00Z'
    expect(elapsed(start, Date.parse('2026-01-05T10:03:05Z'))).toBe('3m 5s')
    const run = { name: 'CI', runNumber: 12, repo: 'acme/api', status: 'completed', conclusion: 'failure', startedAt: start, updatedAt: '2026-01-05T11:30:00Z' } as WorkflowRun
    expect(trayLabel(run, Date.parse('2026-01-06T00:00:00Z'))).toBe('CI #12 · acme/api · failed 1h 30m')
  })
})
