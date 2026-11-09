import type { ItemProjects, ProjectItem, ProjectStatusChange } from '../shared/types'
import type { GitHub, GraphqlError } from './github'

// Projects (v2) for one issue or PR: which projects it's in and its Status in each. Loaded when an issue or PR
// view opens, never by the poller. Reading needs the read:project scope and changing Status needs project, which
// many tokens (including gh's default login) don't have, so a missing scope is explained rather than shown as a failure.

const ITEM_FIELDS = `nodes {
  id
  isArchived
  project {
    id title number url closed
    field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name color } } }
  }
  fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId } }
}`

export const PROJECT_ITEMS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      ... on Issue { projectItems(first: 20) { ${ITEM_FIELDS} } }
      ... on PullRequest { projectItems(first: 20) { ${ITEM_FIELDS} } }
    }
  }
}`

export interface ProjectItemNode {
  id: string
  isArchived: boolean
  project: {
    id: string
    title: string
    number: number
    url: string
    closed: boolean
    field: { id?: string; options?: { id: string; name: string; color?: string }[] } | null
  } | null
  fieldValueByName: { optionId?: string | null } | null
}

interface ProjectItemsData {
  repository: { issueOrPullRequest: { projectItems?: { nodes: (ProjectItemNode | null)[] } | null } | null } | null
}

const SCOPE_HINT =
  "Your GitHub token can't read Projects. A classic token needs the read:project scope (project to change Status); with the GitHub CLI run: gh auth refresh -s project"

/** True for the errors GitHub gives a token that lacks the project scopes (classic) or project access (fine-grained). */
export function isScopeError(e: Pick<GraphqlError, 'type' | 'message'>): boolean {
  return e.type === 'INSUFFICIENT_SCOPES' || /read:project|\bproject\b.*scope|not accessible by (personal access|integration)/i.test(e.message)
}

/** Maps the query's nodes to items; archived items and ones in projects we can't see are left out. */
export function toProjectItems(nodes: (ProjectItemNode | null)[]): ProjectItem[] {
  return nodes.flatMap((n): ProjectItem[] => {
    if (!n?.project || n.isArchived) return []
    const p = n.project
    const field = p.field?.id && p.field.options ? { fieldId: p.field.id, options: p.field.options.map((o) => ({ id: o.id, name: o.name, color: o.color })) } : undefined
    return [
      {
        itemId: n.id,
        projectId: p.id,
        title: p.title,
        number: p.number,
        url: p.url,
        closed: p.closed,
        ...(field && { status: { ...field, optionId: n.fieldValueByName?.optionId ?? null } })
      }
    ]
  })
}

/** Interprets the reply: items, or the reason the token can't see them. Other errors still fail. */
export function readProjectItems(data: ProjectItemsData | undefined, errors: GraphqlError[]): ItemProjects {
  const nodes = data?.repository?.issueOrPullRequest?.projectItems?.nodes
  if (errors.some(isScopeError) && !nodes?.length) return { items: [], missingScope: SCOPE_HINT }
  if (!nodes && errors.length) throw new Error(errors.map((e) => e.message).join('; '))
  return { items: toProjectItems(nodes ?? []) }
}

export async function itemProjects(gh: GitHub, repo: string, num: number): Promise<ItemProjects> {
  const [owner, name] = repo.split('/')
  const { data, errors } = await gh.graphqlPartial<ProjectItemsData>(PROJECT_ITEMS_QUERY, { owner, name, number: num })
  return readProjectItems(data, errors)
}

const SET_STATUS = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } }
}`

const CLEAR_STATUS = `mutation($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) { projectV2Item { id } }
}`

export async function setProjectStatus(gh: GitHub, c: ProjectStatusChange): Promise<void> {
  // Node ids from GitHub are opaque strings; they only ever travel as GraphQL variables, never into the query text.
  const ids = [c.projectId, c.itemId, c.fieldId, ...(c.optionId === null ? [] : [c.optionId])]
  if (!ids.every((v) => typeof v === 'string' && v.length > 0 && v.length < 200)) throw new Error('Invalid project item')
  const vars = { project: c.projectId, item: c.itemId, field: c.fieldId }
  const { errors } = await gh.graphqlPartial(c.optionId === null ? CLEAR_STATUS : SET_STATUS, c.optionId === null ? vars : { ...vars, option: c.optionId })
  if (errors.some(isScopeError)) throw new Error("Your GitHub token can't change projects: it needs the project scope (gh auth refresh -s project).")
  if (errors.length) throw new Error(errors.map((e) => e.message).join('; '))
}
