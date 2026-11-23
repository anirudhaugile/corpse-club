/**
 * Story room UI: the turn-1 writing strip, the numbered reveal with its
 * heading, and the AI epilogue label. Drives the real form for both lines.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { MultiplayerUser } from 'deepspace/testing'

async function action(page: Page, name: string, params: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
      const { token } = (await t.json()) as { token: string }
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return (await res.json()) as { success: boolean; data?: any }
    },
    { name, params },
  )
}

async function writeLine(page: Page, text: string) {
  const turn = page.getByTestId('your-turn')
  await turn.locator('textarea').fill(text)
  const send = turn.getByRole('button', { name: /pass it on/i })
  await expect(send).toBeEnabled({ timeout: 15_000 })
  await send.click()
}

test('turn-1 strip, numbered reveal with heading, AI epilogue label', async ({ users }) => {
  test.setTimeout(90_000)
  const accounts = loadAllTestAccounts()
  const names = ['corpse-a@deepspace.test', 'corpse-b@deepspace.test'].map((e) => {
    const acc = accounts.find((x) => x.email === e)
    expect(acc, `${e} must exist in the local test-account registry`).toBeTruthy()
    return acc!.name!
  })
  const [a, b] = (await users(names)) as [MultiplayerUser, MultiplayerUser]
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
  for (const u of [a, b]) await expect(u.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

  const created = await action(a.page, 'createStory', { title: 'UI check', maxPlayers: 2, maxTurns: 2 })
  const storyId = created.data.storyId as string
  expect((await action(b.page, 'joinStory', { storyId })).success).toBe(true)
  expect((await action(a.page, 'startStory', { storyId })).success).toBe(true)

  await test.step('turn 1: a single writing strip labelled "First line"', async () => {
    await a.page.goto(`/stories/${storyId}`)
    const turn = a.page.getByTestId('your-turn')
    await expect(turn).toBeVisible({ timeout: 15_000 })
    await expect(turn.locator('.strip')).toHaveCount(1)
    await expect(turn.locator('label[for="next-line"]')).toHaveText('First line')
    await expect(turn.locator('textarea')).toHaveAttribute('placeholder', 'Begin the story…')
    await expect(turn.getByText('You start the story')).toHaveCount(0)
    await expect(turn.getByTestId('previous-line')).toHaveCount(0)
  })

  await writeLine(a.page, 'The clock forgot which way it went.')

  await test.step('turn 2: previous strip + "Your line" strip', async () => {
    await b.page.goto(`/stories/${storyId}`)
    const turn = b.page.getByTestId('your-turn')
    await expect(turn.getByTestId('previous-line')).toHaveText('The clock forgot which way it went.', { timeout: 15_000 })
    await expect(turn.locator('label[for="next-line"]')).toHaveText('Your line')
    await expect(turn.locator('textarea')).toHaveAttribute('placeholder', 'Continue the story…')
  })

  await writeLine(b.page, 'So it chimed in both directions.')

  await test.step('reveal: heading, numbered strips in order, AI epilogue label', async () => {
    const reveal = b.page.getByTestId('reveal')
    await expect(reveal).toBeVisible({ timeout: 20_000 })
    await expect(b.page.getByTestId('reveal-heading')).toHaveText('The story — written by 2 players')
    await expect(reveal.getByTestId('strip-num')).toHaveText(['Line 1', 'Line 2'])
    await expect(reveal).toContainText('The clock forgot which way it went.')
    const slip = b.page.getByTestId('ai-ending')
    await expect(slip).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect(slip.locator('.ai-slip-label')).toHaveText('AI epilogue (AI-written)')
    await expect(b.page.getByRole('complementary', { name: 'AI epilogue (AI-written)' })).toBeVisible()
  })
})
