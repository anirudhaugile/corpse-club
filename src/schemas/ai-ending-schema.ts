/**
 * Server-only collections for the AI-written story ending and the
 * "it's your turn" email (turnEmailLocks / emailStubSends at the bottom).
 *
 * `aiEndingLocks` is the "exactly one paid call per story, ever" lock — the
 * same pattern as the `lines` turn lock. The job handler inserts a row BEFORE
 * the paid call; `uniqueOn ['storyId']` makes the record room reject every
 * other insert for that story, so concurrent jobs, retries, and duplicate
 * enqueues all lose the race and never reach the integration. The row is
 * never deleted, so a failed generation is never retried.
 *
 * `aiStubCalls` records what the test stub received. It is only registered
 * when the build flag __CORPSE_TEST_HOOKS__ is true (see src/schemas.ts and
 * vite.config.ts), so it does not exist in a production build.
 *
 * No client role can read or write either collection; only server code
 * (RBAC-off action tools) touches them.
 */

import type { CollectionSchema } from 'deepspace/schema'

const CLOSED = { read: false, create: false, update: false, delete: false } as const

export const aiEndingLocksSchema: CollectionSchema = {
  name: 'aiEndingLocks',
  columns: [{ name: 'storyId', storage: 'text', interpretation: 'plain' }],
  uniqueOn: ['storyId'],
  permissions: {
    viewer: CLOSED,
    member: CLOSED,
    admin: CLOSED,
    '*': CLOSED,
  },
}

/**
 * Once-per-story right to initialise aiStatus/aiStartedAt. The final-turn
 * advance inserts here first; only the insert that wins writes the AI
 * fields, so the double-submit repair path can never clobber a result.
 */
export const aiPendingClaimsSchema: CollectionSchema = {
  name: 'aiPendingClaims',
  columns: [{ name: 'storyId', storage: 'text', interpretation: 'plain' }],
  uniqueOn: ['storyId'],
  permissions: {
    viewer: CLOSED,
    member: CLOSED,
    admin: CLOSED,
    '*': CLOSED,
  },
}

export const aiStubCallsSchema: CollectionSchema = {
  name: 'aiStubCalls',
  columns: [
    { name: 'storyId', storage: 'text', interpretation: 'plain' },
    /** JSON of the exact request body the stub was handed. */
    { name: 'body', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: CLOSED,
    member: CLOSED,
    admin: CLOSED,
    '*': CLOSED,
  },
}

/**
 * "It's your turn" email lock: one row per (storyId, turn), inserted BEFORE
 * the send and never deleted, so at most one email per turn change.
 */
export const turnEmailLocksSchema: CollectionSchema = {
  name: 'turnEmailLocks',
  columns: [
    { name: 'storyId', storage: 'text', interpretation: 'plain' },
    { name: 'turn', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['storyId', 'turn'],
  permissions: {
    viewer: CLOSED,
    member: CLOSED,
    admin: CLOSED,
    '*': CLOSED,
  },
}

/** Test builds only (src/schemas.ts): what the email stub was handed. */
export const emailStubSendsSchema: CollectionSchema = {
  name: 'emailStubSends',
  columns: [
    { name: 'storyId', storage: 'text', interpretation: 'plain' },
    { name: 'turn', storage: 'number', interpretation: 'plain' },
    { name: 'to', storage: 'text', interpretation: 'plain' },
    { name: 'body', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: CLOSED,
    member: CLOSED,
    admin: CLOSED,
    '*': CLOSED,
  },
}
