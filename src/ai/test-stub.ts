/**
 * TEST-ONLY stand-in for the paid anthropic/chat-completion call.
 *
 * Two independent locks keep this out of production:
 *
 *   1. Build time. Only src/ai/story-ending.ts `chooseCaller` references this
 *      module, behind `if (__CORPSE_TEST_HOOKS__)`. vite.config.ts defines
 *      that constant as `true` ONLY for `vite serve` started with
 *      CORPSE_AI_STUB=<token> in the environment (tests/playwright.config.ts
 *      sets it; nothing else does). `vite build` — what `deepspace deploy`
 *      ships — defines it as `false`, so this module is not in the bundle.
 *
 *   2. Run time. Even inside a test build, assertStubAllowed() refuses unless
 *      the worker env carries the exact token AND the worker is not deployed
 *      (no API_WORKER / PLATFORM_WORKER service binding, and the local
 *      API_WORKER_URL fallback that `deepspace dev`/`test` writes is present).
 *      A refusal throws: the story is marked failed and NO call is made —
 *      not the stub, and not the paid API either.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { ChatCaller, ChatRequest } from './story-ending'
import fixture from './fixtures/anthropic-chat-completion.json'
import { STUB_ENDING, STUB_FAIL, STUB_LONG_TITLE, STUB_TITLE, STUB_TRUNCATED } from './test-stub-constants'

export const STUB_TOKEN = 'corpse-test-stub-v1'

export function assertStubAllowed(env: Env): void {
  const token = (env as unknown as { CORPSE_AI_STUB?: string }).CORPSE_AI_STUB
  const deployed = Boolean(env.API_WORKER) || Boolean(env.PLATFORM_WORKER) || !env.API_WORKER_URL
  if (token !== STUB_TOKEN || deployed) {
    console.error('[story-ending] test stub refused: not a local test run (no stub, no paid call)')
    throw new Error('test stub refused outside a local test run')
  }
}

/** The recorded response shape, with only the reply text swapped. */
function envelopeWith(text: string): unknown {
  const copy = structuredClone(fixture) as { data: { content: { type: string; text: string }[] } }
  copy.data.content[0].text = text
  return copy
}

export function stubCaller(env: Env, tools: ActionTools, storyId: string): ChatCaller {
  return async (body: ChatRequest) => {
    assertStubAllowed(env)
    // Record exactly what the stub was handed (test 4 inspects it).
    await tools.create('aiStubCalls', { storyId, body: JSON.stringify(body) })
    const story = body.messages[0]?.content ?? ''
    if (story.includes(STUB_TRUNCATED)) {
      // The production failure: reply cut off at max_tokens mid-JSON.
      const cut = structuredClone(fixture) as { data: { stop_reason: string; content: { text: string }[] } }
      cut.data.stop_reason = 'max_tokens'
      cut.data.content[0].text = '{"title": "A Cut' // deliberately unterminated
      return cut
    }
    if (story.includes(STUB_FAIL)) {
      return { success: false, code: 'upstream_error', error: 'Stubbed upstream failure' }
    }
    const title = story.includes(STUB_LONG_TITLE) ? 'one two three four five six seven eight nine ten eleven' : STUB_TITLE
    return envelopeWith(JSON.stringify({ title, ending: STUB_ENDING }))
  }
}
