import { describe, expect, it } from 'vitest'
import { commentDiscussion, discussionDetail, listDiscussions, readDiscussions } from '../../src/main/discussions'
import type { GitHub } from '../../src/main/github'
import { isScopeError, itemProjects, readProjectItems, setProjectStatus, type ProjectItemNode } from '../../src/main/projects'
import { listIssues, listMilestones, setIssueMilestone, toMilestone, type GhMilestone } from '../../src/main/repoTools'
import { byCategory, dueLabel, milestoneProgress } from '../../src/shared/collab'
import { filterSearchItems } from '../../src/shared/search'
import type { SearchItem } from '../../src/shared/types'

// Milestones, Projects (v2) and Discussions: mapping GitHub's replies with a fake client.

const calls: { kind: string; path?: string; query?: string; vars?: unknown; body?: unknown }[] = []
const fakeGh = (over: Partial<Record<'get' | 'send' | 'graphql' | 'graphqlPartial', (...a: never[]) => unknown>>) => {
  calls.length = 0
  return {
    get: async (path: string) => (calls.push({ kind: 'get', path }), (over.get as (p: string) => unknown)?.(path)),
    send: async (method: string, path: string, body: unknown) => (calls.push({ kind: method, path, body }), null),
    graphql: async (query: string, vars: unknown) => (calls.push({ kind: 'graphql', query, vars }), (over.graphql as (q: string, v: unknown) => unknown)?.(query, vars)),
    graphqlPartial: async (query: string, vars: unknown) => (calls.push({ kind: 'graphql', query, vars }), (over.graphqlPartial as (q: string, v: unknown) => unknown)?.(query, vars) ?? { errors: [] })
  } as unknown as GitHub
}

const gm = (over: Partial<GhMilestone>): GhMilestone => ({
  number: 1,
  title: 'v1',
  description: '',
  state: 'open',
  open_issues: 1,
  closed_issues: 3,
  due_on: null,
  closed_at: null,
  html_url: 'https://github.com/o/r/milestone/1',
  ...over
})

describe('milestones', () => {
  it('maps GitHub fields, with an empty description as null', () => {
    expect(toMilestone(gm({ due_on: '2026-12-01T08:00:00Z' }))).toEqual({
      number: 1,
      title: 'v1',
      description: null,
      state: 'open',
      openIssues: 1,
      closedIssues: 3,
      dueOn: '2026-12-01T08:00:00Z',
      closedAt: null,
      url: 'https://github.com/o/r/milestone/1'
    })
  })

  it('orders open milestones soonest due first and undated last, closed ones newest first', async () => {
    const open = [gm({ number: 1, due_on: null }), gm({ number: 2, due_on: '2026-12-10T00:00:00Z' }), gm({ number: 3, due_on: '2026-11-20T00:00:00Z' })]
    expect((await listMilestones(fakeGh({ get: () => open }), 'o/r', 'open')).map((m) => m.number)).toEqual([3, 2, 1])
    expect(calls[0].path).toBe('/repos/o/r/milestones?state=open&sort=due_on&direction=asc&per_page=100')
    const closed = [gm({ number: 1, state: 'closed', closed_at: '2026-01-01T00:00:00Z' }), gm({ number: 2, state: 'closed', closed_at: '2026-06-01T00:00:00Z' })]
    expect((await listMilestones(fakeGh({ get: () => closed }), 'o/r', 'closed')).map((m) => m.number)).toEqual([2, 1])
  })

  it('computes progress, including an empty milestone', () => {
    expect(milestoneProgress({ openIssues: 2, closedIssues: 3 })).toBe(60)
    expect(milestoneProgress({ openIssues: 0, closedIssues: 0 })).toBe(0)
    expect(milestoneProgress({ openIssues: 0, closedIssues: 4 })).toBe(100)
  })

  it('describes due dates by whole days', () => {
    const now = Date.parse('2026-11-08T15:00:00Z')
    expect(dueLabel(null, now)).toEqual({ text: 'No due date', overdue: false })
    expect(dueLabel('2026-11-08T07:00:00Z', now)).toEqual({ text: 'Due today', overdue: false })
    expect(dueLabel('2026-11-09T07:00:00Z', now)).toEqual({ text: 'Due in 1 day', overdue: false })
    expect(dueLabel('2026-11-13T07:00:00Z', now)).toEqual({ text: 'Due in 5 days', overdue: false })
    expect(dueLabel('2026-11-06T07:00:00Z', now)).toEqual({ text: 'Overdue by 2 days', overdue: true })
  })

  it('filters issues by milestone on GitHub and maps each issue’s milestone', async () => {
    const issue = { number: 4, title: 't', html_url: '', state: 'open', user: null, created_at: '', updated_at: '', comments: 0, labels: [], assignees: null }
    const gh = fakeGh({ get: () => [{ ...issue, milestone: { number: 2, title: 'v2', extra: 1 } }, { ...issue, number: 5, milestone: null }, { ...issue, number: 6, pull_request: {} }] })
    const list = await listIssues(gh, 'o/r', 'open', 2)
    expect(calls[0].path).toContain('&milestone=2')
    expect(list.map((i) => [i.number, i.milestone])).toEqual([
      [4, { number: 2, title: 'v2' }],
      [5, null]
    ])
    await listIssues(gh, 'o/r', 'open', 'none')
    expect(calls.at(-1)!.path).toContain('&milestone=none')
    await listIssues(gh, 'o/r', 'closed')
    expect(calls.at(-1)!.path).not.toContain('milestone')
  })

  it('sets or clears an issue’s milestone, and refuses anything but a milestone number', async () => {
    const gh = fakeGh({})
    await setIssueMilestone(gh, 'o/r', 4, 2)
    expect(calls[0]).toMatchObject({ kind: 'PATCH', path: '/repos/o/r/issues/4', body: { milestone: 2 } })
    await setIssueMilestone(gh, 'o/r', 4, null)
    expect(calls[1]).toMatchObject({ body: { milestone: null } })
    await expect(setIssueMilestone(gh, 'o/r', 4, 1.5)).rejects.toThrow()
    await expect(setIssueMilestone(gh, 'o/r', 4, '3; drop' as unknown as number)).rejects.toThrow()
  })

  it('the search widget filters by milestone', () => {
    const item = (number: number, milestone?: string) => ({ number, milestone, labels: [] }) as unknown as SearchItem
    const items = [item(1, 'v1.3'), item(2), item(3, 'Backlog')]
    const matches = (hay: string, q: string) => hay.toLowerCase().includes(q.toLowerCase())
    expect(filterSearchItems(items, { milestone: 'v1' }, matches).map((i) => i.number)).toEqual([1])
    expect(filterSearchItems(items, { milestone: '' }, matches)).toHaveLength(3)
  })
})

describe('projects', () => {
  const node = (over: Partial<ProjectItemNode> = {}): ProjectItemNode => ({
    id: 'PVTI_1',
    isArchived: false,
    project: {
      id: 'PVT_1',
      title: 'Roadmap',
      number: 1,
      url: 'https://github.com/orgs/o/projects/1',
      closed: false,
      field: { id: 'F', options: [{ id: 'a', name: 'Todo', color: 'GRAY' }, { id: 'b', name: 'Done' }] }
    },
    fieldValueByName: { optionId: 'b' },
    ...over
  })
  const reply = (nodes: (ProjectItemNode | null)[] | null) => ({ repository: { issueOrPullRequest: { projectItems: nodes && { nodes } } } })

  it('maps items with their Status field and current option', () => {
    expect(readProjectItems(reply([node()]), [])).toEqual({
      items: [
        {
          itemId: 'PVTI_1',
          projectId: 'PVT_1',
          title: 'Roadmap',
          number: 1,
          url: 'https://github.com/orgs/o/projects/1',
          closed: false,
          status: { fieldId: 'F', optionId: 'b', options: [{ id: 'a', name: 'Todo', color: 'GRAY' }, { id: 'b', name: 'Done', color: undefined }] }
        }
      ]
    })
  })

  it('leaves out archived items, hidden projects and null nodes; a project without Status has no status', () => {
    const r = readProjectItems(reply([node({ isArchived: true }), node({ project: null }), null, node({ id: 'X', fieldValueByName: null, project: { ...node().project!, field: {} } })]), [])
    expect(r.items).toHaveLength(1)
    expect(r.items[0].itemId).toBe('X')
    expect(r.items[0].status).toBeUndefined()
  })

  it('explains a missing scope instead of failing', () => {
    const scopes = [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query. The 'projectItems' field requires one of the following scopes: ['read:project']" }]
    expect(readProjectItems(reply(null), scopes)).toMatchObject({ items: [], missingScope: expect.stringContaining('read:project') })
    // Fine-grained tokens get FORBIDDEN instead.
    expect(isScopeError({ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' })).toBe(true)
    expect(isScopeError({ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' })).toBe(false)
  })

  it('still fails on other errors with no data', () => {
    expect(() => readProjectItems(undefined, [{ message: 'Something broke' }])).toThrow('Something broke')
    expect(readProjectItems({ repository: null }, [])).toEqual({ items: [] })
  })

  it('queries by issue or PR number', async () => {
    const gh = fakeGh({ graphqlPartial: () => ({ data: reply([node()]), errors: [] }) })
    expect((await itemProjects(gh, 'o/r', 9)).items).toHaveLength(1)
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r', number: 9 })
    expect(calls[0].query).toContain('issueOrPullRequest')
  })

  it('sets or clears the Status field, passing ids only as variables', async () => {
    const gh = fakeGh({})
    await setProjectStatus(gh, { projectId: 'P', itemId: 'I', fieldId: 'F', optionId: 'O' })
    expect(calls[0].query).toContain('updateProjectV2ItemFieldValue')
    expect(calls[0].vars).toEqual({ project: 'P', item: 'I', field: 'F', option: 'O' })
    await setProjectStatus(gh, { projectId: 'P', itemId: 'I', fieldId: 'F', optionId: null })
    expect(calls[1].query).toContain('clearProjectV2ItemFieldValue')
    await expect(setProjectStatus(gh, { projectId: '', itemId: 'I', fieldId: 'F', optionId: 'O' })).rejects.toThrow()
  })

  it('turns a scope error from the mutation into advice', async () => {
    const gh = fakeGh({ graphqlPartial: () => ({ errors: [{ type: 'INSUFFICIENT_SCOPES', message: "requires one of the following scopes: ['project']" }] }) })
    await expect(setProjectStatus(gh, { projectId: 'P', itemId: 'I', fieldId: 'F', optionId: 'O' })).rejects.toThrow(/project scope/)
  })
})

describe('discussions', () => {
  const qa = { id: 'C1', name: 'Q&A', isAnswerable: true }
  const ideas = { id: 'C2', name: 'Ideas', isAnswerable: false }
  const summary = (number: number, category: typeof qa, over: object = {}) => ({
    number,
    title: `D${number}`,
    url: `https://github.com/o/r/discussions/${number}`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    upvoteCount: 3,
    closed: false,
    isAnswered: false,
    author: { login: 'ann', avatarUrl: 'a.png' },
    category,
    comments: { totalCount: 4 },
    ...over
  })

  it('says when a repo has discussions turned off', () => {
    expect(readDiscussions('o/r', { repository: { hasDiscussionsEnabled: false, discussionCategories: null, discussions: null } })).toEqual({ enabled: false, categories: [], discussions: [] })
    expect(() => readDiscussions('o/gone', { repository: null })).toThrow(/not found/)
  })

  it('maps discussions; answered only applies to Q&A categories', async () => {
    const gh = fakeGh({
      graphql: () => ({
        repository: {
          hasDiscussionsEnabled: true,
          discussionCategories: { nodes: [qa, ideas, null] },
          discussions: { nodes: [summary(1, qa, { isAnswered: true }), summary(2, ideas, { isAnswered: false, author: null }), null] }
        }
      })
    })
    const r = await listDiscussions(gh, 'o/r')
    expect(r.categories).toEqual([qa, ideas])
    expect(r.discussions[0]).toEqual({
      number: 1,
      title: 'D1',
      url: 'https://github.com/o/r/discussions/1',
      author: 'ann',
      authorAvatar: 'a.png',
      category: qa,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      comments: 4,
      upvotes: 3,
      answered: true,
      closed: false
    })
    expect(r.discussions[1]).toMatchObject({ answered: null, author: 'ghost' })
  })

  it('groups by category in the repo’s order, keeping unknown categories and dropping empty ones', async () => {
    const other = { id: 'C9', name: 'Other', isAnswerable: false }
    const list = (await listDiscussions(
      fakeGh({
        graphql: () => ({
          repository: {
            hasDiscussionsEnabled: true,
            discussionCategories: { nodes: [qa, ideas, { id: 'C3', name: 'Empty', isAnswerable: false }] },
            discussions: { nodes: [summary(1, ideas), summary(2, other), summary(3, qa), summary(4, ideas)] }
          }
        })
      }),
      'o/r'
    ))!
    expect(byCategory(list.categories, list.discussions).map((g) => [g.category.name, g.discussions.map((d) => d.number)])).toEqual([
      ['Q&A', [3]],
      ['Ideas', [1, 4]],
      ['Other', [2]]
    ])
  })

  it('maps a discussion with comments, the answer and replies', async () => {
    const comment = (id: string, over: object = {}) => ({ id, url: `u-${id}`, bodyHTML: `<p>${id}</p>`, createdAt: '2026-01-03T00:00:00Z', author: { login: 'bob', avatarUrl: '' }, ...over })
    const gh = fakeGh({
      graphql: () => ({
        repository: {
          discussion: {
            ...summary(5, qa, { isAnswered: true }),
            id: 'D_5',
            bodyHTML: '<p>body</p>',
            locked: false,
            comments: { totalCount: 60, nodes: [comment('c1', { isAnswer: true, replies: { nodes: [comment('r1', { author: null }), null] } }), null] }
          }
        }
      })
    })
    const d = await discussionDetail(gh, 'o/r', 5)
    expect(calls[0].vars).toEqual({ owner: 'o', name: 'r', number: 5 })
    expect(d).toMatchObject({ id: 'D_5', number: 5, bodyHtml: '<p>body</p>', commentCount: 60, answered: true, locked: false })
    expect(d.comments).toEqual([
      {
        id: 'c1',
        author: 'bob',
        authorAvatar: '',
        createdAt: '2026-01-03T00:00:00Z',
        bodyHtml: '<p>c1</p>',
        url: 'u-c1',
        isAnswer: true,
        replies: [{ id: 'r1', author: 'ghost', authorAvatar: '', createdAt: '2026-01-03T00:00:00Z', bodyHtml: '<p>r1</p>', url: 'u-r1', isAnswer: false, replies: [] }]
      }
    ])
  })

  it('reports a missing discussion', async () => {
    await expect(discussionDetail(fakeGh({ graphql: () => ({ repository: { discussion: null } }) }), 'o/r', 9)).rejects.toThrow(/#9 was not found/)
  })

  it('adds a comment by node id and refuses an empty one', async () => {
    const gh = fakeGh({ graphql: () => ({}) })
    await commentDiscussion(gh, 'D_5', 'Thanks!')
    expect(calls[0].vars).toEqual({ id: 'D_5', body: 'Thanks!' })
    expect(calls[0].query).toContain('addDiscussionComment')
    await expect(commentDiscussion(gh, 'D_5', '   ')).rejects.toThrow()
  })
})
