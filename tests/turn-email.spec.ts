/**
 * "It's your turn" email — stubbed. Never sends real email: the test server
 * runs with the test-only stub token (tests/playwright.config.ts), so
 * src/notify/turn-email.ts `chooseEmailSender` returns the stub, which
 * records each email in the test-build-only `emailStubSends` collection and
 * returns the response shape recorded from the one real probe send.
 *
 * The test accounts are @deepspace.test; with the stub selected the
 * test_address rule does NOT apply, so these tests exercise the full send.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { MultiplayerUser } from 'deepspace/testing'
import { TURN_EMAIL_JOB, buildTurnEmail } from '../src/notify/turn-email-config'
import { STUB_EMAIL_FAIL } from '../src/ai/test-stub-constants'

const EMAIL_A = 'corpse-a@deepspace.test'
const EMAIL_B = 'corpse-b@deepspace.test'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ID = /^DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/m.exec(readFileSync(resolve(root, 'wrangler.toml'), 'utf8'))?.[1]

interface HttpResult {
  status: number
  body: { success?: boolean; data?: any; error?: string; code?: string; [k: string]: unknown }
}
interface Sent {
  turn: number
  to: string
  body: { from: string; to: string; subject: string; text: string }
}

async function token(page: Page): Promise<string> {
  const t = await page.evaluate(async () => {
    const res = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
    return res.ok ? ((await res.json()) as { token?: string }).token ?? null : null
  })
  expect(t, 'session must yield a JWT').toBeTruthy()
  return t as string
}

async function action(page: Page, name: string, params: Record<string, unknown>): Promise<HttpResult> {
  const jwt = await token(page)
  return page.evaluate(
    async ({ name, params, jwt }) => {
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(params),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    { name, params, jwt },
  )
}

async function sends(page: Page, storyId: string): Promise<Sent[]> {
  const res = await action(page, '_testEmailSends', { storyId })
  expect(res.body, JSON.stringify(res.body)).toMatchObject({ success: true })
  return (res.body.data.sends as Sent[]).sort((x, y) => x.turn - y.turn)
}

async function expectSendCount(page: Page, storyId: string, n: number) {
  await expect.poll(async () => (await sends(page, storyId)).length, { timeout: 15_000 }).toBe(n)
  // Give any straggling duplicate job time to run, then re-check: still n.
  await page.waitForTimeout(1_500)
  expect(await sends(page, storyId)).toHaveLength(n)
}

async function signIn(users: (names: string[]) => Promise<MultiplayerUser[]>) {
  const accounts = loadAllTestAccounts()
  const accA = accounts.find((x) => x.email === EMAIL_A)
  const accB = accounts.find((x) => x.email === EMAIL_B)
  expect(accA, `${EMAIL_A} must exist in the local test-account registry`).toBeTruthy()
  expect(accB, `${EMAIL_B} must exist in the local test-account registry`).toBeTruthy()
  expect(APP_ID).toMatch(/^app_/)
  const [a, b] = (await users([accA!.name!, accB!.name!])) as [MultiplayerUser, MultiplayerUser]
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
  for (const u of [a, b]) await expect(u.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  return { a, b, names: [accA!.name!, accB!.name!] }
}

async function startStory(a: MultiplayerUser, b: MultiplayerUser, title: string, turns: number): Promise<string> {
  const created = await action(a.page, 'createStory', { title, maxPlayers: 2, maxTurns: turns })
  expect(created.body, JSON.stringify(created.body)).toMatchObject({ success: true })
  const storyId = created.body.data.storyId as string
  expect((await action(b.page, 'joinStory', { storyId })).body).toMatchObject({ success: true })
  expect((await action(a.page, 'startStory', { storyId })).body).toMatchObject({ success: true })
  return storyId
}

async function submit(u: MultiplayerUser, storyId: string, text: string) {
  const res = await action(u.page, 'submitLine', { storyId, text })
  expect(res.body, JSON.stringify(res.body)).toMatchObject({ success: true })
  return res.body.data as { turn: number; revealed: boolean }
}

/** Enqueue jobs over the job-room WebSocket as a member (what useJobs does) and collect results. */
async function socketEnqueue(page: Page, payloads: unknown[]) {
  const jwt = await token(page)
  return page.evaluate(
    async ({ appId, jwt, type, payloads }) => {
      const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/jobs/app:${appId}?token=${encodeURIComponent(jwt)}`)
      const msgs: any[] = []
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') msgs.push(JSON.parse(e.data))
      }
      await new Promise<void>((ok, bad) => {
        ws.onopen = () => ok()
        ws.onerror = () => bad(new Error('job socket failed to open'))
      })
      payloads.forEach((payload: unknown, i: number) => {
        ws.send(JSON.stringify({ type: 'job.enqueue', payload: { requestId: `e${i}`, type, payload, maxAttempts: 5 } }))
      })
      const out: any[] = new Array(payloads.length).fill(null)
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline && out.some((x) => x === null)) {
        await new Promise((r) => setTimeout(r, 200))
        payloads.forEach((_p: unknown, i: number) => {
          if (out[i]) return
          const enq = msgs.find((m) => m.type === 'job.update' && m.payload?.kind === 'enqueued' && m.payload?.requestId === `e${i}`)
          if (!enq) return
          const done = msgs.find(
            (m) => m.type === 'job.update' && ['succeeded', 'failed', 'canceled'].includes(m.payload?.kind) && m.payload?.job?.id === enq.payload.job.id,
          )
          if (done) out[i] = { kind: done.payload.kind, result: done.payload.job.result }
        })
      }
      ws.close()
      return out
    },
    { appId: APP_ID, jwt, type: TURN_EMAIL_JOB, payloads },
  )
}

test.describe("It's your turn email (stubbed, no real sends)", () => {
  test.setTimeout(90_000)

  test('1. exactly one send per turn change, to the new current player, never to the submitter', async ({ users }) => {
    const { a, b } = await signIn(users)
    const storyId = await startStory(a, b, 'Turn emails', 3)

    // startStory: turn 1 belongs to the creator who just acted → no email.
    await expectSendCount(a.page, storyId, 0)

    expect(await submit(a, storyId, 'A cat audited the moon.')).toEqual({ turn: 1, revealed: false })
    await expectSendCount(a.page, storyId, 1)
    expect((await sends(a.page, storyId))[0]).toMatchObject({ turn: 1, to: EMAIL_B })

    expect(await submit(b, storyId, 'The moon passed, barely.')).toEqual({ turn: 2, revealed: false })
    await expectSendCount(a.page, storyId, 2)
    const all = await sends(a.page, storyId)
    expect(all.map((s) => [s.turn, s.to])).toEqual([
      [1, EMAIL_B], // A submitted → B's turn
      [2, EMAIL_A], // B submitted → A's turn
    ])

    // Final line reveals: no email on reveal.
    expect(await submit(a, storyId, 'Nobody checked the receipts.')).toEqual({ turn: 3, revealed: true })
    await expectSendCount(a.page, storyId, 2)
  })

  test('2. concurrent submits and racing job runs → one send', async ({ users }) => {
    const { a, b } = await signIn(users)
    const storyId = await startStory(a, b, 'Race email', 3)

    const [s1, s2] = await Promise.all([
      action(a.page, 'submitLine', { storyId, text: 'First try.' }),
      action(a.page, 'submitLine', { storyId, text: 'Second try.' }),
    ])
    const ok = [s1, s2].filter((r) => r.body.success === true)
    expect(ok, JSON.stringify([s1.body, s2.body])).toHaveLength(1)

    // Plus 5 direct runs of the real job path for the same turn, in parallel.
    const runs = await Promise.all(
      Array.from({ length: 5 }, (_, i) => action(i % 2 ? a.page : b.page, '_testRunTurnEmail', { storyId, turn: 1 })),
    )
    for (const r of runs) {
      expect(r.body, JSON.stringify(r.body)).toMatchObject({ success: true })
      expect(['sent', 'skipped']).toContain(r.body.data.outcome)
      if (r.body.data.outcome === 'skipped') expect(r.body.data.failReason).toBe('lock_held')
    }
    await expectSendCount(a.page, storyId, 1)
    expect((await sends(a.page, storyId))[0]).toMatchObject({ turn: 1, to: EMAIL_B })
  })

  test('3. the sent email is the fixed template: no line text, title or names', async ({ users }) => {
    const { a, b, names } = await signIn(users)
    const title = 'Secret Title ZQX 5521'
    const line = 'Secret line ZQX 7734 about the parrot'
    const storyId = await startStory(a, b, title, 2)
    await submit(a, storyId, line)
    await expectSendCount(a.page, storyId, 1)

    const [sent] = await sends(a.page, storyId)
    expect(sent.body).toEqual(buildTurnEmail(EMAIL_B, storyId))
    expect(sent.body.text).toBe(`It's your turn in Corpse Club.\n\nhttps://corpse-club.app.space/stories/${storyId}\n`)
    const raw = JSON.stringify(sent.body)
    for (const forbidden of [title, 'ZQX 5521', line, 'ZQX 7734', 'parrot', ...names]) {
      expect(raw, `email must not contain "${forbidden}"`).not.toContain(forbidden)
    }
  })

  test('4. client-socket enqueues make zero additional sends', async ({ users }) => {
    const { a, b } = await signIn(users)
    const storyId = await startStory(a, b, 'Client enqueue email', 3)

    // Turn 0 is current, and it is the creator's own turn.
    const early = await socketEnqueue(b.page, [{ storyId, turn: 0 }])
    expect(early[0]).toEqual({ kind: 'succeeded', result: { outcome: 'skipped', failReason: 'self_turn' } })
    await expectSendCount(a.page, storyId, 0)

    await submit(a, storyId, 'The kettle filed a complaint.')
    await expectSendCount(a.page, storyId, 1)

    const results = await socketEnqueue(b.page, [
      { storyId, turn: 1 }, // current turn, already emailed
      { storyId, turn: 0 }, // past turn
      { storyId, turn: 2 }, // future turn
      { storyId, turn: '1' }, // malformed
      { storyId: 'not a story id!', turn: 1 }, // malformed
    ])
    expect(results.map((r) => r?.result)).toEqual([
      { outcome: 'skipped', failReason: 'lock_held' },
      { outcome: 'skipped', failReason: 'not_current_turn' },
      { outcome: 'skipped', failReason: 'not_current_turn' },
      { outcome: 'skipped', failReason: 'not_current_turn' },
      { outcome: 'skipped', failReason: 'not_current_turn' },
    ])
    await expectSendCount(a.page, storyId, 1)
    expect((await sends(a.page, storyId))[0]).toMatchObject({ turn: 1, to: EMAIL_B })
  })

  test('5. a failed send does not block the turn (and is not retried)', async ({ users }) => {
    const { a, b } = await signIn(users)
    const storyId = await startStory(a, b, `Email fails ${STUB_EMAIL_FAIL}`, 2)

    expect(await submit(a, storyId, 'The lighthouse blinked twice.')).toEqual({ turn: 1, revealed: false })
    await expectSendCount(a.page, storyId, 1) // attempted once, failed, not retried

    // The game carries on: B gets exactly the previous line and can submit.
    const prev = await action(b.page, 'getPreviousLine', { storyId })
    expect(prev.body).toEqual({ success: true, data: { line: 'The lighthouse blinked twice.' } })
    expect(await submit(b, storyId, 'Then it went to bed.')).toEqual({ turn: 2, revealed: true })
    await expectSendCount(a.page, storyId, 1)
  })
})
