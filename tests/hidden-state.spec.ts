/**
 * Hidden-state spec for the Exquisite Corpse game.
 *
 * Two non-owner members (corpse-a / corpse-b) play a 4-turn story through
 * the server actions in src/actions/index.ts and prove that the `lines`
 * collection is never readable by a player except through getPreviousLine,
 * which hands out exactly one previous line to the player whose turn it is.
 *
 * Direct reads of `lines` are attempted on two caller-scoped paths:
 *   - the record WebSocket (`/ws/app:<id>`, `core.subscribe`) — the path
 *     useQuery uses — with a `stories` subscription on the same socket as the
 *     positive control, and the `lines` subscription kept open for the whole
 *     game to prove no live `core.record_change` for a line ever arrives;
 *   - the browser agent-tool route (`records_query`), which runs as the
 *     caller through the same room RBAC.
 *
 * Unlike collab.spec.ts this spec does NOT skip when accounts are missing:
 * a missing account is a hard failure.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { MultiplayerUser } from 'deepspace/testing'

const EMAIL_A = 'corpse-a@deepspace.test'
const EMAIL_B = 'corpse-b@deepspace.test'
const MAX_TURNS = 4

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ID = /^DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/m.exec(
  readFileSync(resolve(root, 'wrangler.toml'), 'utf8'),
)?.[1]
/** Only this key is read from the CLI-generated .dev.vars. */
function ownerUserId(): string | undefined {
  try {
    return /^OWNER_USER_ID=(.*)$/m.exec(readFileSync(resolve(root, '.dev.vars'), 'utf8'))?.[1]
      ?.trim()
      .replace(/^"|"$/g, '')
  } catch {
    return undefined
  }
}

interface HttpResult {
  status: number
  body: { success?: boolean; data?: any; error?: string; code?: string; [k: string]: unknown }
}

/** Fetch a fresh JWT from the session cookie — what the SDK's getAuthToken() does. */
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

async function agentTool(page: Page, name: string, input: Record<string, unknown>): Promise<HttpResult> {
  const jwt = await token(page)
  return page.evaluate(
    async ({ name, input, jwt }) => {
      const res = await fetch(`/_deepspace/agent/browser/tools/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ input }),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    { name, input, jwt },
  )
}

/**
 * The agent-tool route answers `{ ok: true, result: <tool output> }`, where
 * the tool output is the room's `{ success, data }`; a failed tool answers
 * 422 `{ ok: false, code: 'tool_failed' }`.
 */
async function readStory(page: Page, storyId: string) {
  const res = await agentTool(page, 'records_get', { collection: 'stories', recordId: storyId })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  expect(res.body).toMatchObject({ ok: true, result: { success: true } })
  return res.body.result as { data: { record: { data: Record<string, any> } } }
}

/** Open the record socket as this user and subscribe to `lines` and `stories`. */
async function openRecordSocket(page: Page) {
  const jwt = await token(page)
  await page.evaluate(
    async ({ appId, jwt }) => {
      const w = window as unknown as { __corpse: { msgs: any[]; ws: WebSocket } }
      const url = `${location.origin.replace(/^http/, 'ws')}/ws/app:${appId}?token=${encodeURIComponent(jwt)}`
      const ws = new WebSocket(url)
      w.__corpse = { msgs: [], ws }
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          try {
            w.__corpse.msgs.push(JSON.parse(e.data))
          } catch {
            /* non-JSON frame */
          }
        }
      }
      await new Promise<void>((ok, bad) => {
        ws.onopen = () => ok()
        ws.onerror = () => bad(new Error('record socket failed to open'))
      })
      ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId: 'sub-lines', query: { collection: 'lines' } } }))
      ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId: 'sub-stories', query: { collection: 'stories' } } }))
    },
    { appId: APP_ID, jwt },
  )
}

async function socketMessages(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as unknown as { __corpse: { msgs: any[] } }).__corpse.msgs)
}

async function queryResult(page: Page, subscriptionId: string) {
  await expect
    .poll(async () => (await socketMessages(page)).some((m) => m.type === 'core.query_result' && m.payload?.subscriptionId === subscriptionId), { timeout: 10_000 })
    .toBe(true)
  return (await socketMessages(page)).find((m) => m.type === 'core.query_result' && m.payload?.subscriptionId === subscriptionId)
}

/** The exact denial shape of a direct `lines` read over the agent-tool path. */
async function expectLinesUnreadableViaTool(page: Page) {
  const res = await agentTool(page, 'records_query', { collection: 'lines' })
  console.log('[lines via records_query]', res.status, JSON.stringify(res.body))
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  // Row-level RBAC filters the rows out: an empty result, not an error.
  expect(res.body).toMatchObject({ ok: true, result: { success: true, data: { records: [] } } })
  expect(res.body.result.data.records).toHaveLength(0)
  return res.body
}

test('lines stay hidden; only the current player sees exactly the previous line', async ({ users }) => {
  test.setTimeout(120_000)

  // ── Preconditions: fail, never skip ─────────────────────────────────────
  const accounts = loadAllTestAccounts()
  const accA = accounts.find((a) => a.email === EMAIL_A)
  const accB = accounts.find((a) => a.email === EMAIL_B)
  expect(accA, `${EMAIL_A} must exist in the local test-account registry`).toBeTruthy()
  expect(accB, `${EMAIL_B} must exist in the local test-account registry`).toBeTruthy()
  expect(APP_ID, 'DEEPSPACE_APP_ID must be set in wrangler.toml').toMatch(/^app_/)

  const [a, b] = (await users([accA!.name!, accB!.name!])) as [MultiplayerUser, MultiplayerUser]
  expect(a.email).toBe(EMAIL_A)
  expect(b.email).toBe(EMAIL_B)
  // Visiting a dynamic page signs the user into the app and creates their users row.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
  for (const u of [a, b]) {
    await expect(u.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  }

  // Tool-name check: stop if the browser agent route doesn't expose what we use.
  const jwtA = await token(a.page)
  const listing = await a.page.evaluate(async (jwt) => {
    const res = await fetch('/_deepspace/agent/browser/tools', { headers: { Authorization: `Bearer ${jwt}` } })
    return { status: res.status, text: await res.text() }
  }, jwtA)
  expect(listing.status, listing.text).toBe(200)
  for (const name of ['user_current', 'records_query', 'records_get']) {
    expect(listing.text, `agent tool ${name} must be listed`).toContain(`"${name}"`)
  }

  let storyId = ''
  let userIdA = ''
  let userIdB = ''

  await test.step('0. A and B are both members and neither is the owner', async () => {
    const owner = ownerUserId()
    expect(owner, 'OWNER_USER_ID must be present in .dev.vars').toBeTruthy()
    for (const [u, label] of [[a, 'A'], [b, 'B']] as const) {
      const me = await agentTool(u.page, 'user_current', {})
      expect(me.status, JSON.stringify(me.body)).toBe(200)
      expect(me.body).toMatchObject({ ok: true, result: { success: true } })
      const user = me.body.result.data.user
      expect(user?.role, `${label} role`).toBe('member')
      expect(user?.id, `${label} must not be the app owner`).not.toBe(owner)
      if (label === 'A') userIdA = user.id
      else userIdB = user.id
    }
    expect(userIdA).not.toBe(userIdB)
  })

  await test.step('1. A creates a story; B joins; duplicate join rejected; A starts', async () => {
    const created = await action(a.page, 'createStory', { title: 'Hidden state', maxPlayers: 2, maxTurns: MAX_TURNS })
    expect(created.body, JSON.stringify(created.body)).toMatchObject({ success: true })
    storyId = created.body.data.storyId
    expect(storyId).toBeTruthy()

    const joined = await action(b.page, 'joinStory', { storyId })
    expect(joined.body).toMatchObject({ success: true, data: { participants: [userIdA, userIdB] } })

    const before = await readStory(a.page, storyId)
    const dup = await action(a.page, 'joinStory', { storyId })
    expect(dup.body).toMatchObject({ success: false, code: 'already_joined' })
    const after = await readStory(a.page, storyId)
    expect(JSON.parse(after.data.record.data.participants)).toEqual([userIdA, userIdB])
    expect(after.data.record.data.participants).toBe(before.data.record.data.participants)

    const notCreator = await action(b.page, 'startStory', { storyId })
    expect(notCreator.body).toMatchObject({ success: false, code: 'not_creator' })
    const started = await action(a.page, 'startStory', { storyId })
    expect(started.body).toMatchObject({ success: true, data: { status: 'writing' } })
  })

  // B's live socket subscribes to `lines` BEFORE any line exists and stays open.
  await openRecordSocket(b.page)

  await test.step('2. A (turn 1) gets an explicit empty previous line', async () => {
    const prev = await action(a.page, 'getPreviousLine', { storyId })
    expect(prev.body).toEqual({ success: true, data: { line: null } })
  })

  const line1 = 'The moon wore a borrowed coat'
  await test.step('a. A submits line 1; revealedText still empty', async () => {
    const sub = await action(a.page, 'submitLine', { storyId, text: line1 })
    expect(sub.body).toMatchObject({ success: true, data: { turn: 1, revealed: false } })
    const story = await readStory(b.page, storyId)
    expect(story.data.record.data.revealedText).toBe('')
    expect(story.data.record.data.status).toBe('writing')
  })

  await test.step('b. B gets exactly line 1, nothing else', async () => {
    const prev = await action(b.page, 'getPreviousLine', { storyId })
    expect(prev.body).toEqual({ success: true, data: { line: line1 } })
  })

  await test.step('c. B cannot read lines directly (socket + agent tool)', async () => {
    // Soft assertions: every read path is evaluated and reported, even if an
    // earlier one fails.
    // (c-socket-snapshot) A FRESH subscription, taken now that line 1 exists.
    // The early 'sub-lines' snapshot predates line 1, so it is empty under any
    // policy and proves nothing on its own.
    await b.page.evaluate(() => {
      const w = window as unknown as { __corpse: { ws: WebSocket } }
      w.__corpse.ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId: 'sub-lines-c', query: { collection: 'lines' } } }))
    })
    const snapshot = await queryResult(b.page, 'sub-lines-c')
    expect.soft(snapshot.payload.records, 'c-socket-snapshot: lines over the record socket').toEqual([])
    // (c-socket-live) the subscription open since before line 1 got no line.
    const live = (await socketMessages(b.page)).filter(
      (m) => m.type === 'core.record_change' && m.payload?.collection === 'lines',
    )
    expect.soft(live, 'c-socket-live: lines record_change pushed to B').toEqual([])
    // (c-tool) the agent-tool path, same room RBAC.
    const res = await agentTool(b.page, 'records_query', { collection: 'lines' })
    console.log('[c lines via records_query]', res.status, JSON.stringify(res.body))
    expect.soft(res.body, 'c-tool: lines via records_query').toEqual({
      ok: true,
      result: { success: true, data: { records: [], count: 0, offset: 0 } },
    })
    expect(test.info().errors, 'step c must have no soft failures').toHaveLength(0)
  })

  await test.step('c2. positive control: B reads the story record (same socket and tool)', async () => {
    const storiesResult = await queryResult(b.page, 'sub-stories')
    const mine = storiesResult.payload.records.find((r: any) => (r.recordId ?? r.id) === storyId)
    expect(mine, 'story visible over the record socket').toBeTruthy()

    const story = await readStory(b.page, storyId)
    expect(story.data.record.data).toMatchObject({ title: 'Hidden state', status: 'writing', turnIndex: 1, maxTurns: MAX_TURNS })
    expect(JSON.parse(story.data.record.data.participants)).toEqual([userIdA, userIdB])
  })

  await test.step('d. A getPreviousLine out of turn is rejected', async () => {
    const res = await action(a.page, 'getPreviousLine', { storyId })
    expect(res.body).toEqual({ success: false, code: 'not_your_turn', error: 'It is not your turn' })
  })

  await test.step('e. A submitLine out of turn is rejected', async () => {
    const res = await action(a.page, 'submitLine', { storyId, text: 'sneaky' })
    expect(res.body).toMatchObject({ success: false, code: 'not_your_turn' })
    expect((await readStory(a.page, storyId)).data.record.data.turnIndex).toBe(1)
  })

  await test.step('g. B submits 281 chars -> rejected, nothing written', async () => {
    const res = await action(b.page, 'submitLine', { storyId, text: 'x'.repeat(281) })
    expect(res.body).toMatchObject({ success: false, code: 'line_too_long' })
    expect((await readStory(b.page, storyId)).data.record.data.turnIndex).toBe(1)
    // A (next player after B) would see B's line here if it had been written;
    // it is not A's turn, so verify via B's own previous-line view instead.
    const prev = await action(b.page, 'getPreviousLine', { storyId })
    expect(prev.body).toEqual({ success: true, data: { line: line1 } })
  })

  const line2 = 'and sold the stars for buttons'
  const line2dup = line2 + ' (dup)'
  let winnerText = ''
  let loserText = ''
  await test.step('h. two concurrent submits for one turn -> one line, one advance', async () => {
    const texts = [line2, line2dup]
    const [r1, r2] = await Promise.all(texts.map((text) => action(b.page, 'submitLine', { storyId, text })))
    const outcomes = [r1.body, r2.body]
    console.log('[h] concurrent outcomes:', JSON.stringify(outcomes))
    const winIdx = outcomes.findIndex((o) => o.success === true)
    const losses = outcomes.filter((o) => o.success === false)
    expect(outcomes.filter((o) => o.success === true), 'exactly one submit wins').toHaveLength(1)
    expect(losses, 'exactly one submit loses').toHaveLength(1)

    // Either rejection is correct. turn_already_taken: both passed the turn
    // check and uniqueOn refused the second insert. not_your_turn: the loser
    // loaded the story after the winner advanced, so uniqueOn was not reached.
    const loserCode = losses[0].code
    console.log(
      `[h] loser code: ${loserCode} — ${
        loserCode === 'turn_already_taken' ? 'uniqueOn path REACHED' : 'uniqueOn path NOT reached'
      }`,
    )
    expect(['turn_already_taken', 'not_your_turn']).toContain(loserCode)

    winnerText = texts[winIdx]
    loserText = texts[1 - winIdx]

    // turnIndex advanced exactly once (1 -> 2), not twice.
    const story = await readStory(b.page, storyId)
    expect(story.data.record.data.turnIndex, 'turnIndex advanced exactly once').toBe(2)

    // Exactly one line for turn index 1, and it is the winner's: the next
    // player's view of the previous line is the winner's text. (revealedText
    // in step i proves the loser's line was never stored.)
    const prev = await action(a.page, 'getPreviousLine', { storyId })
    expect(prev.body).toEqual({ success: true, data: { line: winnerText } })
  })

  const line3 = 'that rolled beneath the sea'
  const line4 = 'where fish now fasten their coats'
  await test.step('i. finish; both read revealedText while lines stays unreadable', async () => {
    expect((await action(a.page, 'submitLine', { storyId, text: line3 })).body).toMatchObject({ success: true, data: { turn: 3, revealed: false } })
    expect((await action(b.page, 'getPreviousLine', { storyId })).body).toEqual({ success: true, data: { line: line3 } })
    expect((await action(b.page, 'submitLine', { storyId, text: line4 })).body).toMatchObject({ success: true, data: { turn: 4, revealed: true } })

    // Exactly four stored lines, one per turn; the race loser's text is absent.
    const expected = [line1, winnerText, line3, line4].join('\n')
    for (const u of [a, b]) {
      const story = await readStory(u.page, storyId)
      expect(story.data.record.data).toMatchObject({ status: 'revealed', turnIndex: MAX_TURNS, revealedText: expected })
      expect(story.data.record.data.revealedText.split('\n')).toHaveLength(MAX_TURNS)
      expect(story.data.record.data.revealedText.split('\n')).not.toContain(loserText)
      await expectLinesUnreadableViaTool(u.page)
    }
    // After reveal nobody can pull lines through the actions either.
    expect((await action(a.page, 'getPreviousLine', { storyId })).body).toMatchObject({ success: false, code: 'not_writing' })

    // The live socket opened before line 1 never received a line.
    const msgs = await socketMessages(b.page)
    const lineChanges = msgs.filter((m) => m.type === 'core.record_change' && m.payload?.collection === 'lines')
    expect(lineChanges).toEqual([])
    // ...while it did receive story changes (the subscription was live).
    expect(msgs.some((m) => m.type === 'core.record_change' && m.payload?.collection === 'stories')).toBe(true)
    // A fresh subscription after the reveal is still empty.
    await b.page.evaluate(() => {
      const w = window as unknown as { __corpse: { ws: WebSocket } }
      w.__corpse.ws.send(JSON.stringify({ type: 'core.subscribe', payload: { subscriptionId: 'sub-lines-2', query: { collection: 'lines' } } }))
    })
    expect((await queryResult(b.page, 'sub-lines-2')).payload.records).toEqual([])
  })
})
