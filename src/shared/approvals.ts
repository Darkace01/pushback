import type { PendingApproval, WorkflowRun } from './types'

/** One entry of GET /repos/{repo}/actions/runs/{id}/pending_deployments. */
export interface GhPendingDeployment {
  environment: { id: number; name: string; html_url?: string }
  wait_timer: number
  current_user_can_approve: boolean
  reviewers: { type: 'User' | 'Team'; reviewer: { login?: string; slug?: string; name?: string } | null }[]
}

/** A waiting run plus what it waits for; null when nothing is pending (approved meanwhile, or no protection rule). */
export function toApproval(run: WorkflowRun, pending: GhPendingDeployment[]): PendingApproval | null {
  if (!pending.length) return null
  return {
    repo: run.repo,
    runId: run.id,
    runName: run.name,
    runNumber: run.runNumber,
    runUrl: run.url,
    branch: run.branch,
    actor: run.actor,
    since: run.updatedAt,
    environments: pending.map((p) => ({
      id: p.environment.id,
      name: p.environment.name,
      url: p.environment.html_url ?? '',
      waitTimer: p.wait_timer,
      canApprove: p.current_user_can_approve,
      reviewers: p.reviewers.map((r) => r.reviewer?.login ?? r.reviewer?.slug ?? r.reviewer?.name ?? '').filter(Boolean)
    }))
  }
}

/** Whether the signed-in user can approve at least one of its environments. */
export const canApprove = (a: PendingApproval): boolean => a.environments.some((e) => e.canApprove)

/** Approvals that newly need you since the last poll, so each one notifies once. */
export function newApprovalsForYou(old: PendingApproval[] | undefined, next: PendingApproval[]): PendingApproval[] {
  const seen = new Set((old ?? []).filter(canApprove).map((a) => a.runId))
  return next.filter((a) => canApprove(a) && !seen.has(a.runId))
}

/** "prod-acme" or "dev, prod-acme" — for titles and toasts. */
export const environmentNames = (a: PendingApproval): string => a.environments.map((e) => e.name).join(', ')
