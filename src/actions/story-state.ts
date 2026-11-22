/**
 * Story state helpers shared by the game actions (src/actions/index.ts) and,
 * in test builds only, src/actions/test-actions.ts.
 *
 * Runs with RBAC off via action tools; see the trust model in
 * src/server/action-routes.ts.
 */

import { enqueueJob } from 'deepspace/worker'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { STORY_ENDING_JOB } from '../ai/story-ending'
import { TURN_EMAIL_JOB } from '../notify/turn-email-config'

export type StoryStatus = 'open' | 'writing' | 'revealed'

export interface Story {
  id: string
  title: string
  creatorId: string
  participants: string[]
  maxPlayers: number
  turnIndex: number
  maxTurns: number
  status: StoryStatus
  revealedText: string
}

export function fail(code: string, error: string): ActionResult {
  return { success: false, code, error }
}

function parseParticipants(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
  if (typeof raw !== 'string' || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export async function loadStory(tools: ActionTools, storyId: unknown): Promise<Story | ActionResult> {
  if (typeof storyId !== 'string' || storyId === '') {
    return fail('invalid_story_id', 'storyId is required')
  }
  const res = await tools.get('stories', storyId)
  if (!res.success) return fail('story_not_found', 'Story not found')
  const d = res.data.record.data
  return {
    id: storyId,
    title: String(d.title ?? ''),
    creatorId: String(d.creatorId ?? ''),
    participants: parseParticipants(d.participants),
    maxPlayers: Number(d.maxPlayers ?? 0),
    turnIndex: Number(d.turnIndex ?? 0),
    maxTurns: Number(d.maxTurns ?? 0),
    status: String(d.status ?? '') as StoryStatus,
    revealedText: String(d.revealedText ?? ''),
  }
}

export function isStory(value: Story | ActionResult): value is Story {
  return !('success' in value)
}

export async function findLine(tools: ActionTools, storyId: string, turnIndex: number) {
  const res = await tools.query('lines', { where: { storyId, turn: turnIndex }, limit: 1 })
  if (!res.success) return null
  return res.data.records[0] ?? null
}

/**
 * Advance a story past `turnIndex` (whose line is known to exist). Writes the
 * ABSOLUTE next index, never an increment, so two callers repairing the same
 * turn converge on one value. On the final turn it assembles revealedText.
 */
export async function advancePast(tools: ActionTools, story: Story, turnIndex: number): Promise<ActionResult> {
  const next = turnIndex + 1
  if (next < story.maxTurns) {
    return tools.update('stories', story.id, { turnIndex: next })
  }
  const all = await tools.query('lines', {
    where: { storyId: story.id },
    orderBy: 'turn',
    orderDir: 'asc',
    limit: story.maxTurns,
  })
  if (!all.success) return fail('reveal_failed', 'Could not assemble the story')
  const revealedText = all.data.records.map((r) => String(r.data.text ?? '')).join('\n')

  // AI fields are initialised at most once per story, ever. The record room
  // has no conditional update, so a read-then-write check would still race;
  // instead the first caller to insert the uniqueOn ['storyId'] claim is the
  // only writer allowed to set aiStatus/aiStartedAt. A later writer — the
  // double-submit repair path, or any stale caller — writes the reveal fields
  // only, so it can never reset a 'done' or 'failed' story to 'pending'.
  // aiTitle/aiEnding are never written here at all; only the job writes them.
  const claim = await tools.create('aiPendingClaims', { storyId: story.id })
  if (!claim.success && !claim.error.startsWith('Duplicate:')) {
    console.warn(`[story-ending] pending claim failed for ${story.id}: ${claim.error}`)
  }
  const aiInit = claim.success ? { aiStatus: 'pending', aiStartedAt: Date.now() } : {}

  // One write commits the reveal (and, for the claim winner, marks the AI
  // ending pending), so the reveal never waits on generation and the job's
  // gate sees both at once.
  return tools.update('stories', story.id, {
    turnIndex: next,
    status: 'revealed',
    revealedText,
    ...aiInit,
  })
}

/**
 * Queue the AI ending AFTER the reveal is committed. Never fails the caller:
 * if the enqueue throws, the story stays 'pending' and the UI shows it as
 * failed after 2 minutes. Duplicate enqueues are harmless — the job's
 * uniqueOn lock lets only one of them reach the paid call.
 */
export async function enqueueEnding(env: Env, storyId: string, userId: string): Promise<void> {
  try {
    await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, STORY_ENDING_JOB, { storyId }, { maxAttempts: 1, enqueuedBy: userId })
  } catch (err) {
    console.error(`[story-ending] enqueue failed for ${storyId}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Queue the "it's your turn" email for `turn` AFTER the turn change is
 * committed. Never fails the caller. The job decides everything (recipient,
 * self-turn, address) from server state; duplicates are refused by its lock.
 */
export async function enqueueTurnEmail(env: Env, storyId: string, turn: number, userId: string): Promise<void> {
  try {
    await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, TURN_EMAIL_JOB, { storyId, turn }, { maxAttempts: 1, enqueuedBy: userId })
  } catch {
    // No error text: keep turn-email logs free of anything but ids and enums.
    console.error(`[turn-email] enqueue failed for ${storyId} turn ${turn}`)
  }
}

/**
 * The double-submit repair: a submit that lost the uniqueOn turn race (or a
 * resubmit after an earlier advance failed) finishes advancing the story.
 * `fresh` is the caller's snapshot of the story, which may already be stale
 * by the time this writes — advancePast is written to be safe under that.
 */
export async function repairAdvance(
  tools: ActionTools,
  env: Env,
  fresh: Story,
  turn: number,
  userId: string,
): Promise<void> {
  if (!(await findLine(tools, fresh.id, turn))) return
  const repaired = await advancePast(tools, fresh, turn)
  if (!repaired.success) return
  if (turn + 1 >= fresh.maxTurns) await enqueueEnding(env, fresh.id, userId)
  else await enqueueTurnEmail(env, fresh.id, turn + 1, userId) // no email on reveal
}
