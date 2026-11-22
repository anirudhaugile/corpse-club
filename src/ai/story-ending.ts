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
 *
 * Diagnostics: every call that gets past the lock emits exactly one log line
 * (logEndingDiagnostic) with storyId, outcome, an enum failure reason, the
 * stop_reason and token counts. It never contains story text or any part of
 * the model's reply. The same enum is stored on the story as aiFailReason.
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

/**
 * Why an ending failed — a fixed enum, safe to log and to store on the story
 * (aiFailReason). Never carries free text.
 */
export const FAIL_REASONS = [
  'max_tokens', // stop_reason max_tokens: the reply was cut off (checked before parsing)
  'refusal', // stop_reason refusal: the model declined
  'upstream_error', // the integration returned a failure envelope
  'call_error', // the call threw or timed out
  'bad_shape', // the envelope/message/JSON isn't the recorded shape
  'not_json', // the reply text is not JSON
  'missing_keys', // the JSON lacks title or ending
  'empty_field', // title or ending is blank
  'invalid_chars', // control characters in title or ending
  'title_too_long', // > 10 words or > 100 chars
  'ending_too_long', // > 3 sentences or > 600 chars
  'lock_error', // the lock insert failed for a reason other than a duplicate (no call made)
] as const
export type FailReason = (typeof FAIL_REASONS)[number]

export type ParseResult = { ok: true; ending: AiEnding } | { ok: false; reason: FailReason }

export type EndingOutcome =
  | { outcome: 'done' }
  | { outcome: 'failed'; reason: FailReason }
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
 * recorded in src/ai/fixtures/anthropic-chat-completion.json. Any mismatch is
 * a failure with an enum reason; nothing is truncated or repaired.
 */
export function parseEnding(envelope: unknown): ParseResult {
  const fail = (reason: FailReason): ParseResult => ({ ok: false, reason })
  if (!isRecord(envelope) || envelope.success !== true) return fail('upstream_error')
  if (!isRecord(envelope.data)) return fail('bad_shape')
  const msg = envelope.data
  // Checked before anything else in the message: a cut-off reply is never parsed.
  if (msg.stop_reason === 'max_tokens') return fail('max_tokens')
  if (msg.stop_reason === 'refusal') return fail('refusal')
  if (msg.type !== 'message' || msg.role !== 'assistant' || msg.stop_reason !== 'end_turn') return fail('bad_shape')
  if (!Array.isArray(msg.content) || msg.content.length !== 1) return fail('bad_shape')
  const block: unknown = msg.content[0]
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return fail('bad_shape')

  let reply: unknown
  try {
    reply = JSON.parse(block.text)
  } catch {
    return fail('not_json')
  }
  if (!isRecord(reply)) return fail('bad_shape')
  if (!('title' in reply) || !('ending' in reply)) return fail('missing_keys')
  if (Object.keys(reply).length !== 2) return fail('bad_shape')
  if (typeof reply.title !== 'string' || typeof reply.ending !== 'string') return fail('bad_shape')

  const title = reply.title.trim()
  const ending = reply.ending.trim()
  if (title === '' || ending === '') return fail('empty_field')
  if (CONTROL_CHARS.test(title) || CONTROL_CHARS.test(ending)) return fail('invalid_chars')
  if (title.length > MAX_TITLE_CHARS || countWords(title) > MAX_TITLE_WORDS) return fail('title_too_long')
  if (ending.length > MAX_ENDING_CHARS || countSentences(ending) > MAX_ENDING_SENTENCES) return fail('ending_too_long')
  return { ok: true, ending: { title, ending } }
}

/** One diagnostic record per call. Only ids, enums, slugs and numbers. */
export interface EndingDiagnostic {
  storyId: string
  outcome: 'done' | 'failed'
  reason: FailReason | null
  stop_reason: string | null
  upstream_code: string | null
  input_tokens: number | null
  output_tokens: number | null
  thinking_tokens: number | null
}

/** Accept only short API slugs (e.g. "end_turn", "insufficient_credits"); anything else → null. */
function slug(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : null
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Pulls the safe metrics out of an envelope. Reads only stop_reason, the
 * failure `code` slug, and usage numbers — never content, text or messages.
 */
export function buildDiagnostic(storyId: string, envelope: unknown, result: ParseResult | { ok: false; reason: FailReason }): EndingDiagnostic {
  const env = isRecord(envelope) ? envelope : {}
  const data = isRecord(env.data) ? env.data : {}
  const usage = isRecord(data.usage) ? data.usage : {}
  const details = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {}
  return {
    storyId,
    outcome: result.ok ? 'done' : 'failed',
    reason: result.ok ? null : result.reason,
    stop_reason: slug(data.stop_reason),
    upstream_code: env.success === false ? slug(env.code) : null,
    input_tokens: count(usage.input_tokens),
    output_tokens: count(usage.output_tokens),
    thinking_tokens: count(details.thinking_tokens),
  }
}

export function logEndingDiagnostic(d: EndingDiagnostic): void {
  console.info(`[story-ending] ${JSON.stringify(d)}`)
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
    logEndingDiagnostic(buildDiagnostic(storyId, null, { ok: false, reason: 'lock_error' }))
    await tools.update('stories', storyId, { aiStatus: 'failed', aiFailReason: 'lock_error' })
    return { outcome: 'failed', reason: 'lock_error' }
  }

  // ── 3. The one paid call, made only by the lock winner.
  let envelope: unknown = null
  let result: ParseResult
  try {
    envelope = await withTimeout(call(buildRequest(String(story.revealedText ?? ''))), AI_CALL_TIMEOUT_MS)
    // ── 4. Strict parse (max_tokens checked first).
    result = parseEnding(envelope)
  } catch {
    // No error text is logged: it could echo request or reply content.
    result = { ok: false, reason: 'call_error' }
  }

  // ── 5. One safe log line, then store the result or fail closed. No retry.
  logEndingDiagnostic(buildDiagnostic(storyId, envelope, result))
  if (!result.ok) {
    await tools.update('stories', storyId, { aiStatus: 'failed', aiFailReason: result.reason })
    return { outcome: 'failed', reason: result.reason }
  }
  await tools.update('stories', storyId, { aiStatus: 'done', aiTitle: result.ending.title, aiEnding: result.ending.ending })
  return { outcome: 'done' }
}
