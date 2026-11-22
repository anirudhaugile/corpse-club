/**
 * Exquisite Corpse lines — the hidden half of the game state.
 *
 * No client role can read or write this collection, admin and the app owner
 * included (RecordRoom pins the owner to `admin`, and admin is closed here
 * too). Only server actions, which run RBAC-off, touch it, and they hand out
 * at most the single previous line to the player whose turn it is.
 *
 * `uniqueOn` is the turn lock: two concurrent submits for the same turn race
 * to insert, and the record room rejects the second. An explicit recordId
 * would NOT do this — `records.create` with an existing id merges into that
 * record instead of failing.
 */

import type { CollectionSchema } from 'deepspace/schema'

const CLOSED = { read: false, create: false, update: false, delete: false } as const

export const linesSchema: CollectionSchema = {
  name: 'lines',
  columns: [
    { name: 'storyId', storage: 'text', interpretation: 'plain' },
    { name: 'turn', storage: 'number', interpretation: 'plain' },
    { name: 'authorId', storage: 'text', interpretation: 'plain' },
    { name: 'text', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['storyId', 'turn'],
  permissions: {
    viewer: CLOSED,
    member: CLOSED,
    admin: CLOSED,
    '*': CLOSED,
  },
}
