/**
 * Server-enforced story size: maxTurns must be a JSON integer 2..20
 * (src/lib/story-limits.ts, enforced in createStory). The form's min/max
 * is a hint; this spec calls the action directly to prove the server check.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { MultiplayerUser } from 'deepspace/testing'

const EMAIL_A = 'corpse-a@deepspace.test'

async function token(page: Page): Promise<string> {
  const t = await page.evaluate(async () => {
    const res = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
    return res.ok ? ((await res.json()) as { token?: string }).token ?? null : null
  })
  expect(t, 'session must yield a JWT').toBeTruthy()
  return t as string
}

/** Raw POST: the value goes over the wire exactly as given (a string stays a string). */
async function rawAction(page: Page, name: string, body: string) {
  const jwt = await token(page)
  return page.evaluate(
    async ({ name, body, jwt }) => {
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body,
      })
      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }
    },
    { name, body, jwt },
  )
}

/** Stories visible to the caller with exactly this title (equality filter; unknown keys are refused). */
async function storiesTitled(page: Page, title: string) {
  const jwt = await token(page)
  const res = await page.evaluate(
    async ({ title, jwt }) => {
      const r = await fetch('/_deepspace/agent/browser/tools/records_query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ input: { collection: 'stories', where: { title }, limit: 50 } }),
      })
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
    },
    { title, jwt },
  )
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  expect(res.body).toMatchObject({ ok: true, result: { success: true } })
  return res.body.result.data.records as { recordId: string; data: Record<string, unknown> }[]
}

async function signInA(users: (names: string[]) => Promise<MultiplayerUser[]>) {
  const acc = loadAllTestAccounts().find((x) => x.email === EMAIL_A)
  expect(acc, `${EMAIL_A} must exist in the local test-account registry`).toBeTruthy()
  const [a] = (await users([acc!.name!])) as [MultiplayerUser]
  await a.page.goto('/home')
  await expect(a.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  return a
}

test.describe('story size limit (server-enforced)', () => {
  test('maxTurns outside 2..20, or not an integer, is rejected and creates nothing; 20 is accepted', async ({ users }) => {
    test.setTimeout(60_000)
    const a = await signInA(users)
    const stamp = Date.now()

    // Each value is written into the JSON body literally: "20" is a string on the wire.
    const rejected: [string, string][] = [
      ['21', '21'],
      ['1', '1'],
      ['0', '0'],
      ['-5', '-5'],
      ['2.5', '2.5'],
      ['"20" (string)', '"20"'],
    ]
    for (const [label, literal] of rejected) {
      await test.step(`maxTurns ${label} → invalid_max_turns, no story`, async () => {
        const title = `Limit ${stamp} ${label}`
        const res = await rawAction(a.page, 'createStory', `{"title":${JSON.stringify(title)},"maxPlayers":2,"maxTurns":${literal}}`)
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ success: false, code: 'invalid_max_turns' })
        expect(await storiesTitled(a.page, title), 'no story may be created').toHaveLength(0)
      })
    }

    await test.step('maxTurns 20 → accepted', async () => {
      const title = `Limit ${stamp} 20 ok`
      const res = await rawAction(a.page, 'createStory', `{"title":${JSON.stringify(title)},"maxPlayers":2,"maxTurns":20}`)
      expect(res.body, JSON.stringify(res.body)).toMatchObject({ success: true })
      const found = await storiesTitled(a.page, title)
      expect(found).toHaveLength(1)
      expect(found[0].recordId).toBe(res.body.data.storyId)
      expect(found[0].data.maxTurns).toBe(20)
    })

    await test.step('maxPlayers keeps its server rule (2..8, integers only)', async () => {
      for (const literal of ['9', '1', '"3"', '2.5']) {
        const title = `Limit ${stamp} players ${literal}`
        const res = await rawAction(a.page, 'createStory', `{"title":${JSON.stringify(title)},"maxPlayers":${literal},"maxTurns":4}`)
        expect(res.body, literal).toMatchObject({ success: false, code: 'invalid_max_players' })
        expect(await storiesTitled(a.page, title)).toHaveLength(0)
      }
    })

    await test.step('the form hints 2..20 lines via min/max and text', async () => {
      await a.page.goto('/stories')
      const lines = a.page.locator('#story-turns')
      await expect(lines).toBeVisible({ timeout: 15_000 })
      await expect(lines).toHaveAttribute('min', '2')
      await expect(lines).toHaveAttribute('max', '20')
      await expect(a.page.getByTestId('story-limits-hint')).toHaveText('2–8 players, 2–20 lines.')
    })
  })
})
