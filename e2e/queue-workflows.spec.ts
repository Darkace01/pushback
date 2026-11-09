import { expect, test } from '@playwright/test'
import { close, launch, type Ctx } from './launch'

// The merge queue view and the workflow file viewer. Same rules as app.spec.ts: a fresh profile and fake GitHub
// per test, no uncaught errors, and no writes to GitHub.

const WATCHING = { repos: ['acme/api', 'acme/web'], uiVersion: 1, tourDone: true }

let ctx: Ctx
test.afterEach(async ({}, info) => {
  if (!ctx) return
  if (info.status !== info.expectedStatus) await ctx.page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  expect(ctx.gh.writes(), 'requests that would change GitHub').toEqual([])
  expect(ctx.errors, 'uncaught errors in the app').toEqual([])
  await close(ctx)
})

const queueQueries = (c: Ctx) => c.gh.requests.filter((r) => r.path === '/graphql' && (r.body ?? '').includes('mergeQueue(')).length

test('the merge queue opens from a PR, lists every entry in order, and opens their PRs', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await expect(page.locator('.dashboard')).toBeVisible()
  // Never part of the poll: nothing asks for a queue until it is opened.
  expect(queueQueries(ctx)).toBe(0)

  const prs = page.locator('.widget', { has: page.getByRole('heading', { name: 'Pull requests' }) })
  await prs.getByText('Bump lodash from 4.17.20 to 4.17.21').click()
  const status = page.getByRole('region', { name: 'Merge status' })
  await status.getByRole('button', { name: 'View the whole queue' }).click()

  await expect(page.locator('.crumbs li').last()).toHaveText('Merge queue (main)')
  const queue = page.locator('.merge-queue')
  await expect(queue).toContainText('3 entries · squash · every entry must pass · builds up to 5 at once')
  const entries = queue.locator('.queue-entry')
  await expect(entries).toHaveCount(3)
  await expect(entries.nth(0)).toContainText('Fix header layout')
  await expect(entries.nth(0)).toContainText('Mergeable')
  await expect(entries.nth(0)).toContainText('about 1 min to merge')
  await expect(entries.nth(0)).toContainText('jumped the queue')
  await expect(entries.nth(1)).toContainText('Bump lodash')
  await expect(entries.nth(1)).toContainText('Awaiting checks')
  await expect(entries.nth(1)).toContainText('dependabot')
  await expect(entries.nth(1)).toContainText('queued 20m ago by bob')
  await expect(entries.nth(1)).toContainText('about 5 min to merge')
  await expect(entries.nth(2)).toContainText('Unmergeable')
  await expect(entries.nth(2)).not.toContainText('to merge')
  expect(queueQueries(ctx)).toBe(1)

  // An entry opens its PR on top; Esc comes back to the queue.
  await entries.nth(1).click()
  await expect(page.locator('.crumbs li').last()).toContainText('#9')
  await page.keyboard.press('Escape')
  await expect(page.locator('.crumbs li').last()).toHaveText('Merge queue (main)')
  await expect(queue.getByRole('button', { name: 'Open in browser' })).toBeVisible()
})

test('repo tabs have a merge queue section, which says when a repo has none', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await page.locator('.repo-sidebar').getByText('acme/web').click()
  await page.locator('.ws-link', { hasText: 'Merge queue' }).click()
  await expect(page.locator('.crumbs li')).toHaveText(['acme/web', 'Merge queue'])
  await expect(page.locator('.queue-entry')).toHaveCount(3)
  await page.locator('.queue-entry', { hasText: 'Fix header layout' }).click()
  await expect(page.locator('.crumbs li').last()).toContainText('#12')
  await page.keyboard.press('Escape')

  await page.locator('.repo-sidebar').getByText('acme/api').click()
  await page.locator('.ws-link', { hasText: 'Merge queue' }).click()
  await expect(page.locator('.merge-queue')).toContainText("acme/api doesn't use a merge queue on main.")
  await expect(page.locator('.queue-entry')).toHaveCount(0)
})

test('a workflow file opens from the Workflows section with its triggers and a why-not check', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await page.locator('.repo-sidebar').getByText('acme/api').click()
  await page.locator('.ws-link', { hasText: 'Workflows' }).click()
  await page.locator('.row', { hasText: 'Deploy' }).getByRole('button', { name: 'View file' }).click()

  await expect(page.locator('.crumbs li').last()).toHaveText('Deploy')
  await expect(page.getByRole('region', { name: 'Triggers' })).toContainText('Run by hand (workflow_dispatch) · 1 input')
  const code = page.getByLabel('Workflow file')
  await expect(code.locator('.code-line')).toHaveCount(7)
  await expect(code.locator('.code-line').first()).toHaveText('1name: Deploy')
  await expect(code.locator('.tok-key', { hasText: 'workflow_dispatch' })).toBeVisible()
  // A dispatch-only workflow never runs on a push.
  const why = page.getByRole('region', { name: "Why didn't it run" })
  await expect(why.getByRole('status')).toContainText('It only runs when started by hand (workflow_dispatch)')
  await why.getByLabel('Event').selectOption('workflow_dispatch')
  await expect(why.getByRole('status')).toContainText('It would run for this workflow_dispatch.')
  await expect(page.getByRole('button', { name: 'Open in browser' })).toBeVisible()
  // Read at the default branch: no ref.
  expect(ctx.gh.requests.some((r) => r.path === '/repos/acme/api/contents/.github/workflows/deploy.yml')).toBe(true)
})

test("a run's workflow file opens at the run's commit and explains branch and path filters", async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  const runs = page.locator('.widget', { has: page.getByRole('heading', { name: 'Workflow runs' }) })
  await runs.getByText('Update docs').click()
  await page.getByRole('button', { name: 'View workflow file' }).click()

  await expect(page.locator('.crumbs li').last()).toHaveText('CI')
  expect(ctx.gh.requests.some((r) => r.path === `/repos/acme/api/contents/.github/workflows/ci.yml?ref=${'a'.repeat(40)}`)).toBe(true)
  await expect(page.locator('.pr-head')).toContainText('at aaaaaaa')
  const triggers = page.getByRole('region', { name: 'Triggers' })
  await expect(triggers).toContainText('push · to main · not when only docs/** change')
  await expect(triggers).toContainText('pull_request')
  await expect(page.getByLabel('Workflow file').locator('.tok-comment')).toHaveText('# the usual')
  await expect(page.getByLabel('Workflow file').locator('.tok-expr')).toHaveText('${{ github.sha }}')

  const why = page.getByRole('region', { name: "Why didn't it run" })
  const verdict = why.getByRole('status')
  await why.getByLabel('Branch').fill('main')
  await expect(verdict).toContainText('It would run for this push.')
  await why.getByLabel('Changed files').fill('docs/guide.md')
  await expect(verdict).toContainText('Every changed file matches paths-ignore (docs/**).')
  await why.getByLabel('Changed files').fill('docs/guide.md\nsrc/app.ts')
  await expect(verdict).toContainText('It would run for this push.')
  await why.getByLabel('Branch').fill('dev')
  await expect(verdict).toContainText("The branch dev doesn't match its branches filter (main).")
  await why.getByLabel('Commit message').fill('Tidy [skip ci]')
  await expect(verdict.locator('li')).toHaveCount(2)

  await page.keyboard.press('Escape')
  await expect(page.locator('.crumbs li').last()).toHaveText('CI #101')
})
