import type { WorkflowFile } from '../shared/types'
import { parseTriggers } from '../shared/workflowTriggers'
import type { GitHub } from './github'

// A workflow's YAML for the read-only viewer: the file at a ref (the default branch, or a run's commit), its
// parsed triggers, and the workflow's state (a disabled workflow is a common reason nothing ran).

const PATH = /^\.github\/workflows\/[\w.\-/]+\.ya?ml$/
// Branch names, tags or SHAs; anything else (spaces, `..`, a leading dash) is refused before reaching the URL.
const REF = /^(?!-)(?!.*\.\.)[\w.\-/]{1,250}$/

export async function fetchWorkflowFile(gh: GitHub, repo: string, path: string, ref?: string): Promise<WorkflowFile> {
  if (!PATH.test(path) || path.includes('..')) throw new Error(`Not a workflow file: ${path}`)
  if (ref && !REF.test(ref)) throw new Error(`Not a valid ref: ${ref}`)
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const [file, meta] = await Promise.all([
    gh.get<{ content: string; encoding?: string; html_url?: string }>(`/repos/${repo}/contents/${encodeURI(path)}${query}`),
    // The workflows API takes the file name as its id. A missing workflow (e.g. a file only on a branch) isn't fatal.
    gh.get<{ name: string; state: string; html_url: string }>(`/repos/${repo}/actions/workflows/${encodeURIComponent(path.split('/').pop()!)}`).catch(() => null)
  ])
  const content = Buffer.from(file.content ?? '', 'base64').toString('utf8')
  return {
    repo,
    path,
    ref: ref ?? null,
    name: meta?.name ?? null,
    state: meta?.state ?? null,
    content,
    url: file.html_url ?? null,
    triggers: parseTriggers(content)
  }
}
