/**
 * Exquisite Corpse stories — the public half of the game state.
 *
 * Every client can read a story (title, players, whose turn, and the
 * revealed text once finished), but no client can write one: every change
 * goes through the server actions in src/actions/index.ts, which enforce
 * turn order. The hidden lines live in `lines` (lines-schema.ts).
 */

import type { CollectionSchema } from 'deepspace/schema'

const READ_ONLY = { read: true, create: false, update: false, delete: false } as const

export const storiesSchema: CollectionSchema = {
  name: 'stories',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'creatorId', storage: 'text', interpretation: 'plain' },
    /** JSON array of user ids; join order is turn order. */
    { name: 'participants', storage: 'text', interpretation: 'plain' },
    { name: 'maxPlayers', storage: 'number', interpretation: 'plain' },
    /** 0-based index of the line being written; turn N is turnIndex N-1. */
    { name: 'turnIndex', storage: 'number', interpretation: 'plain' },
    { name: 'maxTurns', storage: 'number', interpretation: 'plain' },
    /** 'open' (joining) → 'writing' → 'revealed'. */
    { name: 'status', storage: 'text', interpretation: 'plain' },
    { name: 'revealedText', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: READ_ONLY,
    member: READ_ONLY,
    admin: READ_ONLY,
  },
}
