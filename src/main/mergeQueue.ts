import { toMergeQueue, type MergeQueue, type RawMergeQueue } from '../shared/mergeQueue'
import type { GitHub } from './github'

// One GraphQL query, sent only while the queue view is open: GraphQL has its own hourly budget, so the queue is
// never part of the poll. Without `branch`, GitHub uses the default branch.

const QUERY = `query($owner: String!, $name: String!, $branch: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    mergeQueue(branch: $branch) {
      url
      configuration { mergeMethod mergingStrategy maximumEntriesToBuild }
      entries(first: 100) {
        totalCount
        nodes {
          position state enqueuedAt estimatedTimeToMerge solo jump
          enqueuer { login }
          headCommit { oid }
          pullRequest { number title url author { login avatarUrl } }
        }
      }
    }
  }
}`

export async function fetchMergeQueue(gh: GitHub, repo: string, branch?: string): Promise<MergeQueue> {
  const [owner, name] = repo.split('/')
  const data = await gh.graphql<{ repository: RawMergeQueue | null }>(QUERY, { owner, name, branch: branch || null })
  if (!data.repository) throw new Error(`${repo} was not found`)
  return toMergeQueue(repo, branch, data.repository)
}
