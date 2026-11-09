import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { close, launch, type Ctx } from './launch'
import { startFakeGitHub } from './fake-github'

// Deployment approvals, run artifacts and the job timeline, inline review comments, and GitHub notifications.
// Tests that write name the exact requests they expect; the others check nothing was written.

const WATCHING = { repos: ['acme/api', 'acme/web'], uiVersion: 1, tourDone: true }

let ctx: Ctx
test.afterEach(async ({}, info) => {
  if (!ctx) return
  if (info.status !== info.expectedStatus) await ctx.page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  expect(ctx.errors, 'uncaught errors in the app').toEqual([])
  await close(ctx)
})

const inbox = (page: Page) => page.locator('.widget', { has: page.getByRole('heading', { name: 'My work' }) })

test('a deployment waiting for you shows in the inbox and can be approved from its run', async () => {
  ctx = await launch({ settings: WATCHING, gh: await startFakeGitHub({ waiting: true }) })
  const { page, gh } = ctx
  const box = inbox(page)
  await box.getByRole('tab', { name: /Approvals 1/ }).click()
  await box.getByText('Deploy → prod-acme').click()

  await expect(page.locator('.crumbs li').last()).toHaveText('Deploy #106')
  const panel = page.getByRole('region', { name: 'Waiting for approval' })
  await expect(panel).toContainText('Waiting for approval to deploy to prod-acme')
  await expect(panel).toContainText('Reviewers: octo')
  await panel.getByLabel('Approval comment').fill('Looks safe')
  await panel.getByRole('button', { name: 'Approve and deploy' }).click()

  await expect.poll(() => gh.writes().length).toBe(1)
  expect(gh.bodies).toEqual([{ method: 'POST', path: '/repos/acme/api/actions/runs/106/pending_deployments', body: { environment_ids: [77], state: 'approved', comment: 'Looks safe' } }])
})

test('a finished run lists its artifacts, downloads one, and shows its jobs on a timeline', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh, app } = ctx
  const target = join(ctx.profile, 'dist.zip')
  // Stand in for the save dialog: answer with a path in the throwaway profile.
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
  }, target)

  const runs = page.locator('.widget', { has: page.getByRole('heading', { name: 'Workflow runs' }) })
  await runs.getByText('Add login page').click()
  await expect(page.locator('.crumbs li').last()).toHaveText('CI #103')

  const artifacts = page.getByRole('region', { name: 'Artifacts' })
  await expect(artifacts).toContainText('dist')
  await expect(artifacts).toContainText('1.5 MB')
  await expect(artifacts.locator('.row', { hasText: 'coverage' })).toContainText('Expired')
  await expect(artifacts.locator('.row', { hasText: 'coverage' }).getByRole('button', { name: 'Download' })).toBeDisabled()
  await artifacts.locator('.row', { hasText: 'dist' }).getByRole('button', { name: 'Download' }).click()
  await expect(page.getByText('Saved dist')).toBeVisible()
  expect(readFileSync(target, 'utf8')).toBe('PK fake zip')

  await page.getByRole('tab', { name: 'Timeline' }).click()
  const chart = page.getByRole('list', { name: 'Job timeline' })
  await expect(chart.getByRole('listitem')).toHaveCount(3)
  await expect(chart).toContainText('Total 1m 0s')
  await expect(chart.locator('.timeline-bar.tone-bad')).toHaveCount(1)
  expect(gh.writes()).toEqual([])
})

test('line comments: read a thread in the diff, reply, resolve, and comment on another line', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  const prs = page.locator('.widget', { has: page.getByRole('heading', { name: 'Pull requests' }) })
  await prs.getByText('Add login page').click()
  await page.getByRole('tab', { name: /Files/ }).click()

  const thread = page.getByLabel('Review thread')
  await expect(thread).toContainText('Should this be a function?')
  await expect(page.getByText('1 review thread, 1 unresolved.')).toBeVisible()
  await thread.getByPlaceholder(/Reply/).fill('Good point, done')
  await thread.getByRole('button', { name: 'Reply' }).click()
  await expect.poll(() => gh.bodies.length).toBe(1)
  await thread.getByRole('button', { name: 'Resolve conversation' }).click()
  await expect.poll(() => gh.writes().filter((w) => w.path === '/graphql').length).toBe(1)

  await page.getByRole('button', { name: 'Comment on line 2' }).click()
  await page.getByRole('button', { name: 'Suggest a change' }).click()
  await expect(page.getByPlaceholder(/Comment on this line/)).toHaveValue('```suggestion\n// done\n```')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect.poll(() => gh.bodies.length).toBe(2)

  expect(gh.bodies).toEqual([
    { method: 'POST', path: '/repos/acme/api/pulls/7/comments/801/replies', body: { body: 'Good point, done' } },
    { method: 'POST', path: '/repos/acme/api/pulls/7/comments', body: { body: '```suggestion\n// done\n```', commit_id: 'b'.repeat(40), path: 'src/login.ts', line: 2, side: 'RIGHT' } }
  ])
  const resolve = JSON.parse(gh.writes().find((w) => w.path === '/graphql')!.body!) as { query: string; variables: object }
  expect(resolve.query).toContain('resolveReviewThread')
  expect(resolve.variables).toEqual({ id: 'THREAD_1' })
})

test('GitHub notifications show in the inbox and can be marked read', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  const box = inbox(page)
  await box.getByRole('tab', { name: /Notifications 1/ }).click()
  await expect(box.locator('.row')).toHaveCount(2)
  await expect(box.locator('.row.unread')).toContainText('Release checklist for v2')
  await expect(box.locator('.row.unread')).toContainText('Mentioned')
  await expect(box.locator('.row', { hasText: 'Add login page' })).toContainText('Review requested')
  expect(gh.writes()).toEqual([])

  await box.getByRole('button', { name: 'Mark all as read' }).click()
  await expect(box.locator('.row.unread')).toHaveCount(0)
  await expect(box.getByRole('tab', { name: 'Notifications', exact: true })).toBeVisible()
  expect(gh.writes().map((w) => `${w.method} ${w.path}`)).toEqual(['PUT /notifications'])
})
