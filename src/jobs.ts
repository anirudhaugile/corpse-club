/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every job
 * picked up from the queue. Dispatch on `job.type`; return a JSON result or
 * throw to fail.
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
  throw new Error(`Unknown job type: ${job.type}`)
}
