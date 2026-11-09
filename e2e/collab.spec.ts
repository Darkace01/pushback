import { expect, test } from '@playwright/test'
import { close, launch, type Ctx } from './launch'

// Milestones, Projects (v2) and Discussions in a repo tab. Same rules as app.spec.ts: a fresh profile and fake
// GitHub per test, no uncaught errors, and no writes to GitHub except the ones a test expects and removes.

const WATCHING = { repos: ['acme/api', 'acme/web'], uiVersion: 1, tourDone: true }

let ctx: Ctx
test.afterEach(async ({}, info) => {
  if (!ctx) return
  if (info.status !== info.expectedStatus) await ctx.page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  expect(ctx.gh.writes(), 'requests that would change GitHub').toEqual([])
  expect(ctx.errors, 'uncaught errors in the app').toEqual([])
  await close(ctx)
})

/** Removes the writes a test expected, after checking they're exactly these. */
function takeWrites(expected: { method: string; path: string }[]) {
  const writes = ctx.gh.writes()
  expect(writes.map(({ method, path }) => ({ method, path }))).toEqual(expected)
  const bodies = writes.map((w) => JSON.parse(w.body ?? '{}'))
  ctx.gh.requests.splice(0, ctx.gh.requests.length, ...ctx.gh.requests.filter((r) => !writes.includes(r)))
  return bodies
}

async function openSection(repo: string, section: string) {
  await ctx.page.locator('.repo-sidebar').getByText(repo).click()
  await ctx.page.locator('.ws-link', { hasText: section }).click()
}

test('milestones list their progress and due dates, and filter the issue list', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await openSection('acme/api', 'Issues')
  await expect(page.getByText('Docs typo')).toBeVisible()

  await page.getByRole('tab', { name: /Milestones/ }).click()
  const v13 = page.locator('.milestones .row', { hasText: 'v1.3' })
  await expect(v13).toContainText('60% complete')
  await expect(v13).toContainText('Due in 5 days')
  await expect(v13).toContainText('2 open')
  await expect(v13.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')
  // Soonest due first, undated last.
  await expect(page.locator('.milestones .row-title > .strong')).toHaveText(['v1.3', 'Backlog'])
  await page.getByRole('tab', { name: 'Closed', exact: true }).click()
  await expect(page.locator('.milestones .row', { hasText: 'v1.2' })).toContainText('100% complete')
  await page.getByRole('tab', { name: 'Open', exact: true }).click()

  // Picking a milestone lists its issues, filtered on GitHub's side.
  await page.locator('.milestones .row', { hasText: 'v1.3' }).click()
  await expect(page.getByText('Login fails on Safari')).toBeVisible()
  await expect(page.getByText('Docs typo')).toHaveCount(0)
  expect(ctx.gh.requests.some((r) => r.path.startsWith('/repos/acme/api/issues?') && r.path.includes('milestone=1'))).toBe(true)
  await page.getByLabel('Milestone').selectOption('none')
  await expect(page.getByText('Docs typo')).toBeVisible()
  await expect(page.getByText('Login fails on Safari')).toHaveCount(0)
})

test('an issue shows its milestone and project status, and both can be changed', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await openSection('acme/api', 'Issues')
  await page.getByText('Login fails on Safari').click()

  const milestone = page.locator('.pr-head').getByLabel('Milestone')
  await expect(milestone).toHaveValue('1')
  // The archived project item is left out.
  const status = page.getByLabel('Status in Roadmap')
  await expect(status).toHaveValue('opt_doing')
  await expect(page.getByText('Old board')).toHaveCount(0)

  await status.selectOption('opt_done')
  await expect.poll(() => ctx.gh.writes().length).toBe(1)
  const [mutation] = takeWrites([{ method: 'POST', path: '/graphql' }])
  expect(mutation.query).toContain('updateProjectV2ItemFieldValue')
  expect(mutation.variables).toEqual({ project: 'PVT_roadmap', item: 'PVTI_1', field: 'PVTSSF_status', option: 'opt_done' })

  await milestone.selectOption('2')
  await expect.poll(() => ctx.gh.writes().length).toBe(1)
  const [patch] = takeWrites([{ method: 'PATCH', path: '/repos/acme/api/issues/11' }])
  expect(patch).toEqual({ milestone: 2 })
})

test('discussions are listed by category and open as a page with comments, and a comment can be added', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await openSection('acme/api', 'Discussions')
  const qa = page.locator('.discussion-group', { hasText: 'Q&A' })
  await expect(qa.locator('.row')).toHaveCount(2)
  await expect(qa.locator('.row', { hasText: 'How do I configure SSO?' })).toContainText('Answered')
  await expect(qa.locator('.row', { hasText: 'How do I configure SSO?' })).toContainText('💬 2')
  await expect(page.locator('.discussion-group', { hasText: 'Ideas' }).locator('.row')).toHaveCount(1)

  await page.getByLabel('Category').selectOption({ label: 'Ideas' })
  await expect(page.locator('.discussion-group')).toHaveCount(1)
  await page.getByLabel('Category').selectOption('')

  await page.getByText('How do I configure SSO?').click()
  await expect(page.locator('.crumbs')).toContainText('Discussion #5')
  await expect(page.locator('.markdown', { hasText: 'Where does the SSO config go?' })).toBeVisible()
  await expect(page.locator('.discussion-answer')).toContainText('Set SSO_URL in the config file.')
  await expect(page.locator('.discussion-reply')).toContainText('That worked, thanks!')
  await expect(page.getByRole('button', { name: 'Open in browser' })).toBeVisible()

  await page.getByLabel('Discussion comment').fill('Thanks, all sorted.')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect.poll(() => ctx.gh.writes().length).toBe(1)
  const [mutation] = takeWrites([{ method: 'POST', path: '/graphql' }])
  expect(mutation.query).toContain('addDiscussionComment')
  expect(mutation.variables).toEqual({ id: 'D_kwDO5', body: 'Thanks, all sorted.' })
})

test('a discussion link in an issue opens the discussion inside the app', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await openSection('acme/api', 'Issues')
  await page.getByText('Login fails on Safari').click()
  await page.getByRole('link', { name: 'the SSO discussion' }).click()
  await expect(page.locator('.crumbs')).toContainText('Discussion #5')
  await expect(page.locator('.pr-title')).toContainText('How do I configure SSO?')
})

test('a repo with discussions turned off says so', async () => {
  ctx = await launch({ settings: WATCHING })
  await openSection('acme/web', 'Discussions')
  await expect(ctx.page.getByText('Discussions are turned off for this repository.')).toBeVisible()
})
