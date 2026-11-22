/**
 * TEST-ONLY stand-in for the paid email/send call. Same two locks as
 * src/ai/test-stub.ts: referenced only behind `__CORPSE_TEST_HOOKS__` (false
 * in every `vite build`, so this module is not in a production bundle), and
 * assertStubAllowed() at run time.
 *
 * Records each email it is handed in the test-build-only `emailStubSends`
 * collection and returns the exact response shape recorded from the one real
 * probe send (src/notify/fixtures/email-send.json).
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { assertStubAllowed } from '../ai/test-stub'
import { STUB_EMAIL_FAIL } from '../ai/test-stub-constants'
import fixture from './fixtures/email-send.json'
import type { EmailSender } from './turn-email'

export function stubEmailSender(env: Env, tools: ActionTools, storyId: string, turn: number): EmailSender {
  return {
    kind: 'stub',
    send: async (body) => {
      assertStubAllowed(env)
      await tools.create('emailStubSends', { storyId, turn, to: body.to, body: JSON.stringify(body) })
      // Failure trigger read from the story itself (test builds only).
      const story = await tools.get('stories', storyId)
      const title = story.success ? String(story.data.record.data.title ?? '') : ''
      if (title.includes(STUB_EMAIL_FAIL)) {
        return { success: false, code: 'upstream_error', error: 'Stubbed email failure' }
      }
      return structuredClone(fixture)
    },
  }
}
