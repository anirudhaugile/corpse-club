/**
 * "It's your turn" email job.
 *
 * At most one email per (storyId, turn), to the current-turn player only:
 *   1. gate — the story is 'writing' and on exactly this turn;
 *   2. recipient = participants[turn % n], derived server-side;
 *      actor (who caused the change) = creator for turn 0, else the author
 *      of line turn-1; recipient === actor → skip (self_turn);
 *   3. the address is read server-side (RBAC-off `users` row) and never
 *      leaves this function — not in the log, the job result or a response;
 *   4. lock — insert-first on `turnEmailLocks` uniqueOn ['storyId','turn'],
 *      BEFORE the send, never released;
 *   5. with the REAL sender, an @deepspace.test address is skipped
 *      (test_address); the stub still records it so e2e covers the full path;
 *   6. send once; no retry.
 *
 * The job payload is only { storyId, turn }; nothing in it picks the
 * recipient, so a client-enqueued job can at most re-trigger the same fixed
 * email to the same correct person, which the lock then refuses.
 *
 * Billing: `email` is not in src/integrations.ts → 'developer' → the app
 * owner pays ($0.013/send per the catalog).
 *
 * Logging: one line per run — storyId, turn, outcome, failReason. Never the
 * address, a user id, names, title, story text or upstream messages.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { isStory, loadStory } from '../actions/story-state'
import { STORY_ID_RE, buildTurnEmail } from './turn-email-config'
import type { TurnEmailBody } from './turn-email-config'
import { stubEmailSender } from './test-email-stub'

export { TURN_EMAIL_JOB } from './turn-email-config'

const SEND_TIMEOUT_MS = 30_000

export const TURN_EMAIL_FAIL_REASONS = [
  'not_current_turn', // story not writing, or not on this turn (incl. malformed payload)
  'self_turn', // the recipient is the user who caused the turn change
  'no_recipient', // no participant for the turn, or no usable address
  'lock_held', // an email for this (storyId, turn) was already claimed
  'lock_error', // the lock insert failed for another reason (no send)
  'test_address', // real sender + @deepspace.test address (no send)
  'upstream_error', // email/send returned a failure envelope
  'call_error', // the send threw or timed out
] as const
export type TurnEmailFailReason = (typeof TURN_EMAIL_FAIL_REASONS)[number]

export type TurnEmailOutcome =
  | { outcome: 'sent'; failReason: null }
  | { outcome: 'skipped' | 'failed'; failReason: TurnEmailFailReason }

/** `kind` lets the job apply the test-address rule to the real sender only. */
export interface EmailSender {
  kind: 'real' | 'stub'
  send: (body: TurnEmailBody) => Promise<unknown>
}

export function isTestAddress(address: string): boolean {
  return /@deepspace\.test$/i.test(address.trim())
}

/**
 * The real, owner-billed sender — or, only in a test build, the stub. In a
 * production build __CORPSE_TEST_HOOKS__ is the literal `false`, so the
 * bundler drops the stub branch and ./test-email-stub with it.
 */
export function chooseEmailSender(env: Env, tools: ActionTools, storyId: string, turn: number): EmailSender {
  if (__CORPSE_TEST_HOOKS__) return stubEmailSender(env, tools, storyId, turn)
  return { kind: 'real', send: (body) => tools.integration('email/send', body) }
}

export interface TurnEmailLog {
  storyId: string | null
  turn: number | null
  outcome: TurnEmailOutcome['outcome']
  failReason: TurnEmailFailReason | null
}

export function logTurnEmail(entry: TurnEmailLog): void {
  console.info(`[turn-email] ${JSON.stringify(entry)}`)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e instanceof Error ? e : new Error('send failed'))),
    )
  })
}

const VALID_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function decideAndSend(tools: ActionTools, storyId: string, turn: number, sender: EmailSender): Promise<TurnEmailOutcome> {
  const skip = (failReason: TurnEmailFailReason): TurnEmailOutcome => ({ outcome: 'skipped', failReason })
  const failed = (failReason: TurnEmailFailReason): TurnEmailOutcome => ({ outcome: 'failed', failReason })

  // ── 1. Gate on current server state.
  const story = await loadStory(tools, storyId)
  if (!isStory(story)) return skip('not_current_turn')
  if (story.status !== 'writing' || story.turnIndex !== turn) return skip('not_current_turn')

  // ── 2. Recipient and actor, both derived server-side.
  const n = story.participants.length
  const recipientId = n > 0 ? story.participants[turn % n] : undefined
  if (!recipientId) return skip('no_recipient')
  let actorId: string | undefined
  if (turn === 0) {
    actorId = story.creatorId // only the creator can start a story
  } else {
    const prev = await tools.query('lines', { where: { storyId, turn: turn - 1 }, limit: 1 })
    actorId = prev.success ? String(prev.data.records[0]?.data.authorId ?? '') || undefined : undefined
    if (!actorId) return skip('not_current_turn') // the turn change has no line behind it
  }
  if (recipientId === actorId) return skip('self_turn')

  // ── 3. Address, server-side only.
  const user = await tools.get('users', recipientId)
  const address = user.success ? String(user.data.record.data.email ?? '').trim() : ''
  if (!VALID_ADDRESS.test(address)) return skip('no_recipient')

  // ── 4. Lock BEFORE the send. Never released.
  const lock = await tools.create('turnEmailLocks', { storyId, turn })
  if (!lock.success) {
    return lock.error.startsWith('Duplicate:') ? skip('lock_held') : failed('lock_error')
  }

  // ── 5. Real sender never emails test accounts; the stub still records them.
  if (sender.kind === 'real' && isTestAddress(address)) return skip('test_address')

  // ── 6. The one send.
  try {
    const res = await withTimeout(sender.send(buildTurnEmail(address, storyId)), SEND_TIMEOUT_MS)
    const ok = typeof res === 'object' && res !== null && (res as { success?: unknown }).success === true
    return ok ? { outcome: 'sent', failReason: null } : failed('upstream_error')
  } catch {
    return failed('call_error') // no error text: it could echo the request
  }
}

/** Runs the job for one (storyId, turn) and emits exactly one safe log line. */
export async function runTurnEmail(tools: ActionTools, storyId: unknown, turn: unknown, sender: EmailSender): Promise<TurnEmailOutcome> {
  // Payloads can come from any member's socket: only log values of the expected shape.
  const safeId = typeof storyId === 'string' && STORY_ID_RE.test(storyId) ? storyId : null
  const safeTurn = typeof turn === 'number' && Number.isInteger(turn) && turn >= 0 && turn < 1000 ? turn : null
  const result: TurnEmailOutcome =
    safeId === null || safeTurn === null
      ? { outcome: 'skipped', failReason: 'not_current_turn' }
      : await decideAndSend(tools, safeId, safeTurn, sender)
  logTurnEmail({ storyId: safeId, turn: safeTurn, outcome: result.outcome, failReason: result.failReason })
  return result
}
