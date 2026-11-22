/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every job
 * picked up from the queue. Dispatch on `job.type`; return a JSON result or
 * throw to fail.
 *
 * 'turn-email' — "it's your turn" email to the new current-turn player
 * (src/notify/turn-email.ts). Enqueued by startStory and submitLine with
 * maxAttempts 1; same client-enqueue reasoning as below (gate, then the
 * uniqueOn ['storyId','turn'] lock, before any send).
 *
 * 'story-ending' — the AI-written title and ending for a revealed story
 * (src/ai/story-ending.ts). It is enqueued by submitLine after the reveal is
 * committed, with maxAttempts 1. Members can also enqueue any job type from
 * the client socket (AppJobRoom.authorizeWrite allows members); that is
 * harmless here because runStoryEnding checks status === 'revealed' and
 * aiStatus === 'pending', then takes the uniqueOn ['storyId'] lock, all
 * BEFORE the paid call. The job result carries no story text — every member
 * can see job rows.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { STORY_ENDING_JOB, chooseCaller, runStoryEnding } from './ai/story-ending'
import { TURN_EMAIL_JOB, chooseEmailSender, runTurnEmail } from './notify/turn-email'
import { createActionTools } from './server/action-routes'

export async function runJob(job: Job, _ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === STORY_ENDING_JOB) {
    const payload = job.payload as { storyId?: unknown } | null
    const storyId = typeof payload?.storyId === 'string' ? payload.storyId : ''
    if (storyId === '') return { outcome: 'skipped', reason: 'invalid_payload' }
    // Jobs run as the app owner; 'developer' billing → the owner pays.
    const tools = createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT)
    return runStoryEnding(tools, storyId, chooseCaller(env, tools, storyId))
  }
  if (job.type === TURN_EMAIL_JOB) {
    // Payload is only { storyId, turn }; runTurnEmail re-derives everything
    // (turn, recipient, actor, address) from server state before the lock.
    const payload = job.payload as { storyId?: unknown; turn?: unknown } | null
    const tools = createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT)
    const storyId = typeof payload?.storyId === 'string' ? payload.storyId : ''
    const turn = typeof payload?.turn === 'number' ? payload.turn : -1
    return runTurnEmail(tools, payload?.storyId, payload?.turn, chooseEmailSender(env, tools, storyId, turn))
  }
  throw new Error(`Unknown job type: ${job.type}`)
}
