/**
 * AI-written title and ending for a revealed story.
 *
 * Exactly one paid `anthropic/chat-completion` call per story, ever:
 *   1. the reveal (submitLine) sets aiStatus = 'pending' in the same write
 *      that sets status = 'revealed', then enqueues a 'story-ending' job;
 *   2. the job runs runStoryEnding(), which checks status/aiStatus, then
 *      takes the `aiEndingLocks` uniqueOn ['storyId'] lock, and only the
 *      lock winner makes the paid call;
 *   3. the result is parsed strictly; anything unexpected is 'failed'.
 *      There is no retry anywhere: the lock row is never removed.
 *
 * Billing: anthropic is not listed in src/integrations.ts, so it is
 * 'developer' billed — the app owner pays (action-routes.ts callIntegration).
 *
 * Prompt safety: the request carries ONLY the story's revealedText as the
 * user message, plus a constant system prompt. Output is rendered as plain
 * text by the client (React text nodes), never as HTML.
 */

import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { AI_MAX_TOKENS, AI_MODEL, SYSTEM_PROMPT } from './story-ending-config'
import { stubCaller } from './test-stub'

export { AI_MAX_TOKENS, AI_MODEL, AI_PENDING_TIMEOUT_MS, STORY_ENDING_JOB, SYSTEM_PROMPT } from './story-ending-config'

/** Give up waiting on the upstream call after this long (the call is never retried). */
const AI_CALL_TIMEOUT_MS = 90_000
// The prompt asks for ≤ 8 words and 1-2 sentences; the parser allows a
// little slack so a near-miss isn't thrown away. Beyond these, it fails.
const MAX_TITLE_WORDS = 10
const MAX_ENDING_SENTENCES = 3
const MAX_TITLE_CHARS = 100
const MAX_ENDING_CHARS = 600

export interface ChatRequest {
  model: string
  max_tokens: number
  system: string
  messages: [{ role: 'user'; content: string }]
}

/** Makes the call and returns the integration envelope (`{ success, data }` or a failure). */
export type ChatCaller = (body: ChatRequest) => Promise<unknown>

export interface AiEnding {
  title: string
  ending: string
}

export type EndingOutcome =
  | { outcome: 'done' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'skipped'; reason: 'not_found' | 'not_revealed' | 'not_pending' | 'locked' }

/** The whole request body. revealedText is the only story data in it. */
export function buildRequest(revealedText: string): ChatRequest {
  return {
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: revealedText }],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Titles and abbreviations whose period never ends a sentence (case-insensitive). */
const ABBREVIATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'vs.', 'e.g.', 'i.e.']
const ABBREVIATION_RE = new RegExp(
  `(^|[\\s("'\u201c\u2018])(${ABBREVIATIONS.map((a) => a.replace(/\./g, '\\.')).join('|')})`,
  'gi',
)
/** "etc." and an ellipsis end a sentence only when a capitalized word follows. */
const ETC_CONTINUES_RE = /\betc\.(?!\s+[\p{Lu}"'\u201c\u2018])/giu
const ELLIPSIS_RE = /\.(?:\s*\.){2,}|\u2026/g

/**
 * Sentences = runs of text ended by . ! or ? followed by whitespace or the
 * end (an unterminated tail counts as one). Not sentence ends: the periods
 * in Mr. Mrs. Ms. Dr. St. vs. e.g. i.e.; decimals (3.5); and "etc." or an
 * ellipsis (... or …) unless a capitalized word follows them.
 */
export function countSentences(text: string): number {
  const neutral = text
    .replace(ABBREVIATION_RE, (_m, lead: string, abbr: string) => lead + abbr.replace(/\./g, ''))
    .replace(ETC_CONTINUES_RE, 'etc')
    .replace(/(\d)\.(?=\d)/g, '$1')
    .replace(ELLIPSIS_RE, (_m, offset: number, whole: string) =>
      /^\s+[\p{Lu}"'\u201c\u2018]/u.test(whole.slice(offset + _m.length)) ? '.' : ' ',
    )
  return neutral.split(/[.!?]+(?=[\s"'\u201d\u2019)]|$)/).filter((s) => /[\p{L}\p{N}]/u.test(s)).length
}

/**
 * Strict parse of the anthropic/chat-completion envelope, in the exact shape
 * recorded in src/ai/fixtures/anthropic-chat-completion.json. Returns null —
 * and the caller marks the story 'failed' — on any mismatch, or a title over
 * 10 words, or an ending over 3 sentences. Nothing is truncated.
 */
export function parseEnding(envelope: unknown): AiEnding | null {
  if (!isRecord(envelope) || envelope.success !== true || !isRecord(envelope.data)) return null
  const msg = envelope.data
  if (msg.type !== 'message' || msg.role !== 'assistant' || msg.stop_reason !== 'end_turn') return null
  if (!Array.isArray(msg.content) || msg.content.length !== 1) return null
  const block: unknown = msg.content[0]
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return null

  let reply: unknown
  try {
    reply = JSON.parse(block.text)
  } catch {
    return null
  }
  if (!isRecord(reply)) return null
  const keys = Object.keys(reply).sort()
  if (keys.length !== 2 || keys[0] !== 'ending' || keys[1] !== 'title') return null
  if (typeof reply.title !== 'string' || typeof reply.ending !== 'string') return null

  const title = reply.title.trim()
  const ending = reply.ending.trim()
  if (title === '' || ending === '') return null
  if (CONTROL_CHARS.test(title) || CONTROL_CHARS.test(ending)) return null
  if (title.length > MAX_TITLE_CHARS || ending.length > MAX_ENDING_CHARS) return null
  if (countWords(title) > MAX_TITLE_WORDS) return null
  if (countSentences(ending) > MAX_ENDING_SENTENCES) return null
  return { title, ending }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

/**
 * The real, owner-billed call — or, only in a test build, the stub. In a
 * production build __CORPSE_TEST_HOOKS__ is the literal `false`, so the
 * bundler drops the stub branch and the ./test-stub module with it.
 */
export function chooseCaller(env: Env, tools: ActionTools, storyId: string): ChatCaller {
  if (__CORPSE_TEST_HOOKS__) return stubCaller(env, tools, storyId)
  return (body) => tools.integration('anthropic/chat-completion', body)
}

/**
 * Generate and store the ending for one story. Safe to call any number of
 * times, concurrently, from anywhere: the ordering below guarantees at most
 * one paid call per story.
 */
export async function runStoryEnding(tools: ActionTools, storyId: string, call: ChatCaller): Promise<EndingOutcome> {
  // ── 1. Gate: the story must be revealed and still waiting for its ending.
  const res = await tools.get('stories', storyId)
  if (!res.success) return { outcome: 'skipped', reason: 'not_found' }
  const story = res.data.record.data
  if (story.status !== 'revealed') return { outcome: 'skipped', reason: 'not_revealed' }
  if (story.aiStatus !== 'pending') return { outcome: 'skipped', reason: 'not_pending' }

  // ── 2. Lock: insert-first on uniqueOn ['storyId']. Every caller but one is
  //       refused here, BEFORE any paid call. The row is never deleted.
  const lock = await tools.create('aiEndingLocks', { storyId })
  if (!lock.success) {
    // The record room's uniqueOn refusal reads "Duplicate: a record with …".
    if (lock.error.startsWith('Duplicate:')) return { outcome: 'skipped', reason: 'locked' }
    // Unknown lock error: don't spend, don't retry.
    await tools.update('stories', storyId, { aiStatus: 'failed' })
    return { outcome: 'failed', reason: 'lock_error' }
  }

  // ── 3. The one paid call, made only by the lock winner.
  let envelope: unknown = null
  let reason = 'invalid_response'
  try {
    envelope = await withTimeout(call(buildRequest(String(story.revealedText ?? ''))), AI_CALL_TIMEOUT_MS)
  } catch (err) {
    reason = 'call_error'
    console.warn(`[story-ending] call failed for ${storyId}: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── 4. Strict parse; store the result or fail closed. No retry.
  const parsed = parseEnding(envelope)
  if (!parsed) {
    await tools.update('stories', storyId, { aiStatus: 'failed' })
    return { outcome: 'failed', reason }
  }
  await tools.update('stories', storyId, { aiStatus: 'done', aiTitle: parsed.title, aiEnding: parsed.ending })
  return { outcome: 'done' }
}
