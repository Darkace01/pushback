import type { GitHub } from './github'
import { toApproval, type GhPendingDeployment } from '../shared/approvals'
import type { PendingApproval, RunArtifact, WorkflowRun } from '../shared/types'

/** What a waiting run needs approved. A REST GET, so asking again while nothing changed (304) is free. */
export async function fetchApproval(gh: GitHub, run: WorkflowRun): Promise<PendingApproval | null> {
  const pending = await gh.get<GhPendingDeployment[]>(`/repos/${run.repo}/actions/runs/${run.id}/pending_deployments`)
  return toApproval(run, pending)
}

export async function reviewDeployments(
  gh: GitHub,
  repo: string,
  runId: number,
  environmentIds: number[],
  state: 'approved' | 'rejected',
  comment: string
): Promise<unknown> {
  const ids = environmentIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (!ids.length) throw new Error('Pick at least one environment')
  if (state !== 'approved' && state !== 'rejected') throw new Error('Unknown review state')
  // GitHub rejects an empty comment, so a plain approval still says something.
  const text = String(comment ?? '').trim() || (state === 'approved' ? 'Approved in Pushback' : 'Rejected in Pushback')
  return gh.send('POST', `/repos/${repo}/actions/runs/${Number(runId)}/pending_deployments`, { environment_ids: ids, state, comment: text })
}

interface GhArtifact {
  id: number
  name: string
  size_in_bytes: number
  expired: boolean
  created_at: string
  expires_at: string | null
}

export async function listArtifacts(gh: GitHub, repo: string, runId: number): Promise<RunArtifact[]> {
  const data = await gh.get<{ artifacts: GhArtifact[] }>(`/repos/${repo}/actions/runs/${Number(runId)}/artifacts?per_page=100`)
  return data.artifacts.map((a) => ({ id: a.id, name: a.name, size: a.size_in_bytes, expired: a.expired, createdAt: a.created_at, expiresAt: a.expires_at }))
}

export function artifactZip(gh: GitHub, repo: string, artifactId: number): Promise<Buffer> {
  return gh.binary(`/repos/${repo}/actions/artifacts/${Number(artifactId)}/zip`)
}

/** A file name that is safe on every OS, from an artifact name the workflow chose. */
export function artifactFileName(name: string): string {
  const clean = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120)
  return `${clean || 'artifact'}.zip`
}
