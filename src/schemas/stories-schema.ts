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
    /**
     * AI-written title and ending, generated once per story after the reveal
     * by the 'story-ending' job (src/ai/story-ending.ts). Plain text only.
     */
    { name: 'aiTitle', storage: 'text', interpretation: 'plain' },
    { name: 'aiEnding', storage: 'text', interpretation: 'plain' },
    /** 'pending' (set with the reveal) → 'done' | 'failed'. Absent on older stories. */
    { name: 'aiStatus', storage: 'text', interpretation: 'plain' },
    /** Epoch ms when generation was queued; the UI treats pending > 2 min as failed. */
    { name: 'aiStartedAt', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: READ_ONLY,
    member: READ_ONLY,
    admin: READ_ONLY,
  },
}
