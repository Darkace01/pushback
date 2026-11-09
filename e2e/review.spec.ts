import { expect, test, type Page } from '@playwright/test'
import { close, launch, savedSettings, type Ctx } from './launch'

// PR review actions and notification rules. Unlike the browsing tests, these are allowed to write to the fake
// GitHub, but only the requests each test names.

const WATCHING = { repos: ['acme/api', 'acme/web'], uiVersion: 1, tourDone: true }

let ctx: Ctx
test.afterEach(async ({}, info) => {
  if (!ctx) return
  if (info.status !== info.expectedStatus) await ctx.page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  expect(ctx.errors, 'uncaught errors in the app').toEqual([])
  await close(ctx)
})

async function openPr(page: Page) {
  const prs = page.locator('.widget', { has: page.getByRole('heading', { name: 'Pull requests' }) })
  await prs.getByText('Add login page').click()
  await expect(page.locator('.page')).toBeVisible()
}

test('requesting changes sends a review with the message', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await openPr(page)
  await page.getByRole('button', { name: 'Review…' }).click()

  // Request changes and Comment need a message; the button stays off until there is one.
  await page.getByRole('tab', { name: 'Request changes' }).click()
  const submit = page.getByRole('button', { name: 'Submit review' })
  await expect(submit).toBeDisabled()
  await page.getByPlaceholder('What needs to change?').fill('Please add a test')
  await submit.click()

  await expect.poll(() => gh.writes().length).toBe(1)
  const [write] = gh.writes()
  expect(write.method).toBe('POST')
  expect(write.path).toBe('/repos/acme/api/pulls/7/reviews')
  expect(JSON.parse(write.body ?? '{}')).toEqual({ event: 'REQUEST_CHANGES', body: 'Please add a test' })
})

test('approving needs no message', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await openPr(page)
  await page.getByRole('button', { name: 'Review…' }).click()
  await page.getByRole('tab', { name: 'Approve' }).click()
  await page.getByRole('button', { name: 'Submit review' }).click()

  await expect.poll(() => gh.writes().length).toBe(1)
  expect(JSON.parse(gh.writes()[0].body ?? '{}')).toEqual({ event: 'APPROVE' })
})

test('auto-merge asks GitHub to merge once checks pass, instead of merging now', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await openPr(page)
  await page.getByRole('button', { name: 'Merge…' }).click()
  await page.getByLabel('Merge automatically once checks and reviews pass').check()
  await page.getByRole('button', { name: 'Enable auto-merge' }).click()

  await expect.poll(() => gh.writes().length).toBe(1)
  const [write] = gh.writes()
  expect(write.path).toBe('/graphql')
  const sent = JSON.parse(write.body ?? '{}') as { query: string; variables: Record<string, string> }
  expect(sent.query).toContain('enablePullRequestAutoMerge')
  expect(sent.variables).toEqual({ id: 'PR_node_7', method: 'SQUASH' })
  // It must not also merge directly.
  expect(gh.requests.some((r) => r.method === 'PUT')).toBe(false)
})

test('quiet hours, snooze and muted repos are saved from Settings', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await expect(page.locator('.widget').first()).toBeVisible()
  await page.locator('.search-trigger').click()
  await page.getByPlaceholder(/Search/).fill('open settings')
  await page.keyboard.press('Enter')
  await page.getByRole('tab', { name: 'Notifications' }).or(page.getByRole('button', { name: 'Notifications' })).first().click()

  await page.getByLabel('No notifications during quiet hours').check()
  await page.getByLabel('Quiet hours start').fill('23:30')
  await page.getByLabel('acme/web').check()
  await page.getByRole('button', { name: 'Snooze 1 hour' }).click()

  await expect.poll(() => savedSettings(ctx).notifyRules?.quietHours).toEqual({ enabled: true, start: '23:30', end: '08:00' })
  await expect.poll(() => savedSettings(ctx).notifyRules?.mutedRepos).toEqual(['acme/web'])
  const until = savedSettings(ctx).notifyRules.snoozedUntil as number
  expect(until).toBeGreaterThan(Date.now() + 50 * 60 * 1000)
  expect(until).toBeLessThan(Date.now() + 70 * 60 * 1000)
  await expect(page.getByText(/Notifications are snoozed until/)).toBeVisible()
  await page.getByRole('button', { name: 'Resume now' }).click()
  await expect.poll(() => savedSettings(ctx).notifyRules.snoozedUntil).toBe(0)
  expect(gh.writes()).toEqual([])
})

test('request review suggests code owners and recent reviewers, then requests and removes reviewers', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await openPr(page)
  const reviewers = page.getByRole('region', { name: 'Reviewers' })
  await expect(reviewers.getByTitle('Waiting on octo')).toBeVisible()
  await reviewers.getByRole('button', { name: 'Request review' }).click()

  // CODEOWNERS gives /src/ to bob and the acme/frontend team; carol reviewed recent PRs.
  const bob = reviewers.getByRole('listitem', { name: 'Request bob' })
  await expect(bob).toContainText('Code owner of 1 changed file')
  await expect(reviewers.getByRole('listitem', { name: 'Request acme/frontend' })).toContainText('team')
  await expect(reviewers.getByRole('listitem', { name: 'Request carol' })).toContainText('Reviewed 2 recent PRs')
  await expect(reviewers.getByRole('listitem', { name: 'Request dave' })).toContainText('Collaborator')
  // Not the author, and not someone already requested.
  await expect(reviewers.getByRole('listitem', { name: 'Request alice' })).toHaveCount(0)
  await expect(reviewers.getByRole('listitem', { name: 'Request octo' })).toHaveCount(0)

  await bob.click()
  await expect.poll(() => gh.writes().length).toBe(1)
  expect(gh.writes()[0]).toMatchObject({ method: 'POST', path: '/repos/acme/api/pulls/7/requested_reviewers' })
  expect(JSON.parse(gh.writes()[0].body ?? '{}')).toEqual({ reviewers: ['bob'], team_reviewers: [] })

  await reviewers.getByRole('button', { name: 'Remove octo' }).click()
  await expect.poll(() => gh.writes().length).toBe(2)
  expect(gh.writes()[1]).toMatchObject({ method: 'DELETE', path: '/repos/acme/api/pulls/7/requested_reviewers' })
  expect(JSON.parse(gh.writes()[1].body ?? '{}')).toEqual({ reviewers: ['octo'], team_reviewers: [] })
})

test('the digest options are saved from Settings', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await expect(page.locator('.widget').first()).toBeVisible()
  await page.getByTitle(/Settings/).click()
  await page.getByRole('tab', { name: 'Notifications' }).or(page.getByRole('button', { name: 'Notifications' })).first().click()

  await page.getByLabel('Summarise what I missed when quiet hours or a snooze end').check()
  await page.getByLabel('Send a daily digest').check()
  await page.getByLabel('Daily digest time').fill('17:45')
  await expect.poll(() => savedSettings(ctx).digest).toEqual({ afterQuiet: true, daily: true, dailyAt: '17:45' })
  expect(gh.writes()).toEqual([])
})
