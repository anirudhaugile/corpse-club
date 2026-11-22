import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { PUBLIC_APP_ORIGIN, TURN_EMAIL_FROM, TURN_EMAIL_SUBJECT, buildTurnEmail } from './turn-email-config'
import { TURN_EMAIL_FAIL_REASONS, isTestAddress, runTurnEmail } from './turn-email'
import type { EmailSender } from './turn-email'
import { stubEmailSender } from './test-email-stub'
import fixture from './fixtures/email-send.json'

// Distinctive markers: none of these may ever appear in a log line.
const CREATOR = 'uid_CREATOR_MARKER_51'
const OTHER = 'uid_OTHER_MARKER_77'
const ADDRESS = 'zqx.address.marker@example.com'
const TITLE = 'ZQX TITLE MARKER 3301'
const LINE_TEXT = 'ZQX_LINE_MARKER_8812 the goose sang'
const NAME = 'ZQX Name Marker'
const UPSTREAM_MSG = 'ZQX_UPSTREAM_MSG_4040 mailbox for zqx.address.marker@example.com full'
const STORY = '1795387078406_abc123'

interface FakeOpts {
  status?: string
  turnIndex?: number
  participants?: string[]
  address?: string | null
  lineAuthor?: string | null
  lock?: 'ok' | 'duplicate' | 'error'
}

function fakeTools(o: FakeOpts = {}, created: { collection: string; data: Record<string, unknown> }[] = []): ActionTools {
  const participants = o.participants ?? [CREATOR, OTHER]
  return {
    get: async (collection: string, id: string) => {
      if (collection === 'stories') {
        return {
          success: true,
          data: {
            record: {
              data: {
                title: TITLE,
                creatorId: CREATOR,
                participants: JSON.stringify(participants),
                maxPlayers: 2,
                turnIndex: o.turnIndex ?? 1,
                maxTurns: 4,
                status: o.status ?? 'writing',
                revealedText: LINE_TEXT,
              },
            },
          },
        }
      }
      if (collection === 'users') {
        if (o.address === null) return { success: false, error: 'not found' }
        return { success: true, data: { record: { data: { email: o.address ?? ADDRESS, name: NAME, id } } } }
      }
      return { success: false, error: 'unexpected' }
    },
    query: async () => ({
      success: true,
      data: { records: o.lineAuthor === null ? [] : [{ data: { authorId: o.lineAuthor ?? CREATOR, text: LINE_TEXT } }] },
    }),
    create: async (collection: string, data: Record<string, unknown>) => {
      created.push({ collection, data })
      if (collection === 'turnEmailLocks' && o.lock === 'duplicate') return { success: false, error: 'Duplicate: a record with …' }
      if (collection === 'turnEmailLocks' && o.lock === 'error') return { success: false, error: 'boom' }
      return { success: true, data: { recordId: 'r1' } }
    },
    update: async () => ({ success: true, data: {} }),
  } as unknown as ActionTools
}

function spySender(kind: 'real' | 'stub', result: unknown = fixture): EmailSender & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    kind,
    calls,
    send: async (body) => {
      calls.push(body)
      if (result instanceof Error) throw result
      return result
    },
  }
}

describe('buildTurnEmail — fixed template, no user text', () => {
  it('is exactly the fixed subject, body and constant-origin link', () => {
    expect(buildTurnEmail('to@example.com', STORY)).toEqual({
      from: TURN_EMAIL_FROM,
      to: 'to@example.com',
      subject: "It's your turn in Corpse Club",
      text: `It's your turn in Corpse Club.\n\nhttps://corpse-club.app.space/stories/${STORY}\n`,
    })
    expect(PUBLIC_APP_ORIGIN).toBe('https://corpse-club.app.space')
    expect(TURN_EMAIL_SUBJECT).toBe("It's your turn in Corpse Club")
  })

  it('refuses a story id that is not the server-generated shape', () => {
    expect(() => buildTurnEmail('a@b.co', 'x/../evil')).toThrow()
    expect(() => buildTurnEmail('a@b.co', '<b>hi</b>')).toThrow()
  })
})

describe('runTurnEmail — outcomes', () => {
  afterEach(() => vi.restoreAllMocks())
  const quiet = () => vi.spyOn(console, 'info').mockImplementation(() => {})

  it('sent: turn 1 goes to participant 2, with the fixed body', async () => {
    quiet()
    const created: { collection: string; data: Record<string, unknown> }[] = []
    const s = spySender('real')
    expect(await runTurnEmail(fakeTools({}, created), STORY, 1, s)).toEqual({ outcome: 'sent', failReason: null })
    expect(s.calls).toEqual([buildTurnEmail(ADDRESS, STORY)])
    // Lock taken before the send, keyed by (storyId, turn).
    expect(created).toEqual([{ collection: 'turnEmailLocks', data: { storyId: STORY, turn: 1 } }])
  })

  const cases: [string, FakeOpts, number, string][] = [
    ['not_current_turn — story not writing', { status: 'revealed' }, 1, 'not_current_turn'],
    ['not_current_turn — story on another turn', { turnIndex: 2 }, 1, 'not_current_turn'],
    ['not_current_turn — no line behind the turn change', { lineAuthor: null }, 1, 'not_current_turn'],
    ['self_turn — turn 0, creator holds it (startStory)', { turnIndex: 0 }, 0, 'self_turn'],
    ['self_turn — recipient authored the previous line', { lineAuthor: OTHER }, 1, 'self_turn'],
    ['no_recipient — no users row', { address: null }, 1, 'no_recipient'],
    ['no_recipient — not an address', { address: 'nope' }, 1, 'no_recipient'],
    ['lock_held', { lock: 'duplicate' }, 1, 'lock_held'],
    ['lock_error', { lock: 'error' }, 1, 'lock_error'],
  ]
  for (const [name, opts, turn, reason] of cases) {
    it(`${name} → no send`, async () => {
      quiet()
      const s = spySender('real')
      const r = await runTurnEmail(fakeTools(opts), STORY, turn, s)
      expect(r.failReason).toBe(reason)
      expect(r.outcome).toBe(reason === 'lock_error' ? 'failed' : 'skipped')
      expect(s.calls).toHaveLength(0)
    })
  }

  it('not_current_turn — malformed client payloads', async () => {
    quiet()
    const s = spySender('real')
    for (const [id, turn] of [[STORY, -1], [STORY, 1.5], [STORY, '1'], ['../x', 1], [42, 1]] as const) {
      expect((await runTurnEmail(fakeTools(), id, turn, s)).failReason).toBe('not_current_turn')
    }
    expect(s.calls).toHaveLength(0)
  })

  it('upstream_error and call_error', async () => {
    quiet()
    expect(await runTurnEmail(fakeTools(), STORY, 1, spySender('real', { success: false, code: 'x', error: UPSTREAM_MSG }))).toEqual({
      outcome: 'failed',
      failReason: 'upstream_error',
    })
    expect(await runTurnEmail(fakeTools(), STORY, 1, spySender('real', new Error(UPSTREAM_MSG)))).toEqual({
      outcome: 'failed',
      failReason: 'call_error',
    })
  })

  it('the enum is closed and slug-shaped', () => {
    for (const r of TURN_EMAIL_FAIL_REASONS) expect(r).toMatch(/^[a-z_]+$/)
  })
})

describe('@deepspace.test addresses', () => {
  afterEach(() => vi.restoreAllMocks())

  it('isTestAddress', () => {
    expect(isTestAddress('corpse-b@deepspace.test')).toBe(true)
    expect(isTestAddress(' X@DeepSpace.Test ')).toBe(true)
    expect(isTestAddress('a@deepspace.test.example.com')).toBe(false)
    expect(isTestAddress('a@example.com')).toBe(false)
  })

  it('REAL sender + @deepspace.test → test_address, lock taken, no send', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const created: { collection: string; data: Record<string, unknown> }[] = []
    const s = spySender('real')
    const r = await runTurnEmail(fakeTools({ address: 'corpse-b@deepspace.test' }, created), STORY, 1, s)
    expect(r).toEqual({ outcome: 'skipped', failReason: 'test_address' })
    expect(s.calls).toHaveLength(0)
    expect(created.map((c) => c.collection)).toEqual(['turnEmailLocks'])
  })

  it('STUB sender + @deepspace.test → the stub send is recorded (full path)', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const created: { collection: string; data: Record<string, unknown> }[] = []
    const tools = fakeTools({ address: 'corpse-b@deepspace.test' }, created)
    // Passes the stub's runtime guard: test token, local API_WORKER_URL, no service binding.
    const env = { CORPSE_AI_STUB: 'corpse-test-stub-v1', API_WORKER_URL: 'http://127.0.0.1:1' } as unknown as Env
    const r = await runTurnEmail(tools, STORY, 1, stubEmailSender(env, tools, STORY, 1))
    expect(r).toEqual({ outcome: 'sent', failReason: null })
    const sent = created.find((c) => c.collection === 'emailStubSends')
    expect(sent?.data).toMatchObject({ storyId: STORY, turn: 1, to: 'corpse-b@deepspace.test' })
    expect(JSON.parse(String(sent?.data.body))).toEqual(buildTurnEmail('corpse-b@deepspace.test', STORY))
  })
})

describe('turn-email log line', () => {
  afterEach(() => vi.restoreAllMocks())

  async function capture(run: () => Promise<unknown>) {
    const lines: string[] = []
    for (const m of ['info', 'log', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')))
    }
    await run()
    return lines
  }
  const forbidden = [ADDRESS, 'zqx.address.marker', CREATOR, OTHER, 'MARKER_51', 'MARKER_77', TITLE, LINE_TEXT, 'goose', NAME, UPSTREAM_MSG, 'ZQX_UPSTREAM']

  const runs: [string, () => Promise<unknown>][] = [
    ['sent', () => runTurnEmail(fakeTools(), STORY, 1, spySender('real'))],
    ['upstream_error', () => runTurnEmail(fakeTools(), STORY, 1, spySender('real', { success: false, code: 'x', error: UPSTREAM_MSG }))],
    ['call_error', () => runTurnEmail(fakeTools(), STORY, 1, spySender('real', new Error(UPSTREAM_MSG)))],
    ['self_turn', () => runTurnEmail(fakeTools({ turnIndex: 0 }), STORY, 0, spySender('real'))],
    ['test_address', () => runTurnEmail(fakeTools({ address: 'zqx.address.marker@deepspace.test' }), STORY, 1, spySender('real'))],
    ['malformed payload', () => runTurnEmail(fakeTools(), `x ${TITLE}`, 1, spySender('real'))],
  ]
  for (const [name, run] of runs) {
    it(`${name}: exactly one line, only storyId/turn/outcome/failReason, no markers`, async () => {
      const lines = await capture(run)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^\[turn-email\] \{/)
      const entry = JSON.parse(lines[0].replace('[turn-email] ', '')) as Record<string, unknown>
      expect(Object.keys(entry).sort()).toEqual(['failReason', 'outcome', 'storyId', 'turn'])
      for (const m of forbidden) expect(lines[0], `log must not contain "${m}"`).not.toContain(m)
    })
  }
})
