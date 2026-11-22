/**
 * Client helpers for the Exquisite Corpse game.
 *
 * All game writes go through the server actions in src/actions/index.ts —
 * `stories` is read-only to clients and `lines` is unreadable — so this file
 * only parses the live `stories` record and calls those actions.
 */

import { getAuthToken } from 'deepspace'
import type { RecordData } from 'deepspace'

export const MAX_LINE_LENGTH = 280

export type StoryStatus = 'open' | 'writing' | 'revealed'

/** Raw shape of a `stories` record's data (see src/schemas/stories-schema.ts). */
export interface StoryData {
  title?: string
  creatorId?: string
  participants?: string
  maxPlayers?: number
  turnIndex?: number
  maxTurns?: number
  status?: StoryStatus
  revealedText?: string
}

export interface Story {
  id: string
  title: string
  creatorId: string
  participants: string[]
  maxPlayers: number
  turnIndex: number
  maxTurns: number
  status: StoryStatus
  revealedText: string
  createdAt: string
}

function parseParticipants(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function toStory(record: RecordData<StoryData>): Story {
  const d = record.data
  return {
    id: record.recordId,
    title: d.title ?? '',
    creatorId: d.creatorId ?? '',
    participants: parseParticipants(d.participants),
    maxPlayers: Number(d.maxPlayers ?? 0),
    turnIndex: Number(d.turnIndex ?? 0),
    maxTurns: Number(d.maxTurns ?? 0),
    status: (d.status ?? 'open') as StoryStatus,
    revealedText: d.revealedText ?? '',
    createdAt: record.createdAt,
  }
}

/** Same rule as the server: round-robin over join order. */
export function currentPlayer(story: Story): string | undefined {
  if (story.participants.length === 0) return undefined
  return story.participants[story.turnIndex % story.participants.length]
}

export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; code?: string; error: string }

/** Call a server action as the signed-in user. Never throws. */
export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse<T>> {
  try {
    const token = await getAuthToken()
    if (!token) return { success: false, code: 'signed_out', error: 'Not signed in' }
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => null)) as ActionResponse<T> | null
    if (res.status === 401) return { success: false, code: 'signed_out', error: 'Not signed in' }
    if (!body) return { success: false, code: 'bad_response', error: `HTTP ${res.status}` }
    return body
  } catch {
    return { success: false, code: 'network', error: 'Network error' }
  }
}

const MESSAGES: Record<string, string> = {
  // createStory
  invalid_title: 'Give the story a title (up to 100 characters).',
  invalid_max_players: 'Players must be between 2 and 8.',
  invalid_max_turns: 'Turns must be between 2 and 40.',
  create_failed: 'Could not create the story. Try again.',
  // join / start
  invalid_story_id: 'That story link is invalid.',
  story_not_found: 'That story no longer exists.',
  not_open: 'This story has already started — joining is closed.',
  already_joined: "You're already in this story.",
  story_full: 'This story is full.',
  join_failed: 'Could not join the story. Try again.',
  not_creator: 'Only the person who created the story can start it.',
  not_enough_players: 'At least 2 players need to join before starting.',
  start_failed: 'Could not start the story. Try again.',
  // turns
  not_a_participant: "You're not a player in this story.",
  not_writing: 'This story is not accepting lines right now.',
  not_your_turn: "It's not your turn.",
  previous_line_missing: 'The previous line could not be found.',
  empty_line: 'Write something before submitting.',
  line_too_long: `Lines can be at most ${MAX_LINE_LENGTH} characters.`,
  turn_already_taken: 'A line for this turn was already submitted.',
  insert_failed: 'Could not save your line. Try again.',
  advance_failed: 'Your line was saved but the turn did not advance. Submit again to fix it.',
  // transport
  signed_out: 'You need to sign in again.',
  network: 'Network error — check your connection.',
  bad_response: 'Unexpected server response.',
}

export function errorMessage(res: { code?: string; error: string }): string {
  return (res.code && MESSAGES[res.code]) || res.error || 'Something went wrong.'
}
