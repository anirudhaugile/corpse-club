/**
 * TEST-ONLY server actions. Spread into `actions` (src/actions/index.ts) only
 * behind `__CORPSE_TEST_HOOKS__`, which is `false` in every `vite build`, so
 * neither action exists in a production bundle. Each also re-checks the
 * runtime guard (assertStubAllowed) before doing anything.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { chooseCaller, runStoryEnding } from '../ai/story-ending'
import { assertStubAllowed } from '../ai/test-stub'
import { isStory, loadStory, repairAdvance } from './story-state'

function storyIdOf(params: Record<string, unknown>): string | null {
  return typeof params.storyId === 'string' && params.storyId !== '' ? params.storyId : null
}

const refused: ActionResult = { success: false, code: 'not_found', error: 'Action not found' }

export const testActions: Record<string, ActionHandler<Env>> = {
  /** Every request body the stub received for one story, oldest first. */
  async _testStubCalls({ params, tools, env }) {
    try {
      assertStubAllowed(env)
    } catch {
      return refused
    }
    const storyId = storyIdOf(params)
    if (!storyId) return { success: false, code: 'invalid_story_id', error: 'storyId is required' }
    const res = await tools.query('aiStubCalls', { where: { storyId }, limit: 100 })
    if (!res.success) return { success: false, code: 'query_failed', error: res.error }
    const bodies = res.data.records.map((r) => JSON.parse(String(r.data.body)) as unknown)
    return { success: true, data: { count: bodies.length, bodies } }
  },

  /** Runs the real generation path directly (used to race it concurrently). */
  async _testRunEnding({ params, tools, env }) {
    try {
      assertStubAllowed(env)
    } catch {
      return refused
    }
    const storyId = storyIdOf(params)
    if (!storyId) return { success: false, code: 'invalid_story_id', error: 'storyId is required' }
    const outcome = await runStoryEnding(tools, storyId, chooseCaller(env, tools, storyId))
    return { success: true, data: outcome }
  },

  /**
   * Replays the double-submit repair with a STALE snapshot: the story as a
   * losing submitter would have read it just before the reveal (still
   * 'writing', on its final turn). The guard in submitLine (status ===
   * 'writing') normally stops a late repair, so this is the only way to
   * time the race deterministically. Calls the real repairAdvance().
   */
  async _testRepairStale({ userId, params, tools, env }) {
    try {
      assertStubAllowed(env)
    } catch {
      return refused
    }
    const story = await loadStory(tools, params.storyId)
    if (!isStory(story)) return story
    const turn = story.maxTurns - 1
    const stale = { ...story, status: 'writing' as const, turnIndex: turn }
    await repairAdvance(tools, env, stale, turn, userId)
    return { success: true, data: { replayedTurn: turn } }
  },
}
