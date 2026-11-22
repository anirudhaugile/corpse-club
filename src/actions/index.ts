import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { advancePast, enqueueEnding, enqueueTurnEmail, fail, findLine, isStory, loadStory, repairAdvance } from './story-state'
import type { Story } from './story-state'
import { testActions } from './test-actions'

/**
 * Exquisite Corpse server actions.
 *
 * These run RBAC-off (see src/server/action-routes.ts), so every check below
 * is the only thing standing between a player and the hidden `lines`
 * collection. Identity rule: the caller is ALWAYS `ctx.userId` — the verified
 * JWT subject the route passes in. No user id is ever read from `params`.
 */

export const MAX_LINE_LENGTH = 280
const MIN_PLAYERS = 2
const MAX_PLAYERS_CAP = 8
const MAX_TURNS_CAP = 40
const MAX_TITLE_LENGTH = 100

/** The player whose turn it is; round-robin over join order. */
function currentPlayer(story: Story): string | undefined {
  if (story.participants.length === 0) return undefined
  return story.participants[story.turnIndex % story.participants.length]
}

/** Shared gate for getPreviousLine and submitLine. */
function checkTurn(story: Story, userId: string): ActionResult | null {
  if (!story.participants.includes(userId)) {
    return fail('not_a_participant', 'You are not a player in this story')
  }
  if (story.status !== 'writing') {
    return fail('not_writing', `Story is ${story.status}, not accepting lines`)
  }
  if (currentPlayer(story) !== userId) {
    return fail('not_your_turn', 'It is not your turn')
  }
  return null
}

const gameActions: Record<string, ActionHandler<Env>> = {
  async createStory({ userId, params, tools }) {
    const title = typeof params.title === 'string' ? params.title.trim() : ''
    if (title === '' || title.length > MAX_TITLE_LENGTH) {
      return fail('invalid_title', `Title must be 1-${MAX_TITLE_LENGTH} characters`)
    }
    const maxPlayers = Number(params.maxPlayers)
    if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS_CAP) {
      return fail('invalid_max_players', `maxPlayers must be ${MIN_PLAYERS}-${MAX_PLAYERS_CAP}`)
    }
    const maxTurns = Number(params.maxTurns)
    if (!Number.isInteger(maxTurns) || maxTurns < MIN_PLAYERS || maxTurns > MAX_TURNS_CAP) {
      return fail('invalid_max_turns', `maxTurns must be ${MIN_PLAYERS}-${MAX_TURNS_CAP}`)
    }
    const res = await tools.create('stories', {
      title,
      creatorId: userId,
      participants: JSON.stringify([userId]),
      maxPlayers,
      turnIndex: 0,
      maxTurns,
      status: 'open',
      revealedText: '',
    })
    if (!res.success) return fail('create_failed', res.error)
    return { success: true, data: { storyId: res.data.recordId } }
  },

  async joinStory({ userId, params, tools }) {
    const story = await loadStory(tools, params.storyId)
    if (!isStory(story)) return story
    if (story.status !== 'open') return fail('not_open', 'Story is no longer open for joining')
    if (story.participants.includes(userId)) return fail('already_joined', 'You already joined')
    if (story.participants.length >= story.maxPlayers) return fail('story_full', 'Story is full')
    const participants = [...story.participants, userId]
    const res = await tools.update('stories', story.id, { participants: JSON.stringify(participants) })
    if (!res.success) return fail('join_failed', res.error)
    return { success: true, data: { participants } }
  },

  async startStory({ userId, params, tools, env }) {
    const story = await loadStory(tools, params.storyId)
    if (!isStory(story)) return story
    if (story.creatorId !== userId) return fail('not_creator', 'Only the creator can start')
    if (story.status !== 'open') return fail('not_open', 'Story already started')
    if (story.participants.length < MIN_PLAYERS) {
      return fail('not_enough_players', `Need at least ${MIN_PLAYERS} players`)
    }
    const res = await tools.update('stories', story.id, { status: 'writing', turnIndex: 0 })
    if (!res.success) return fail('start_failed', res.error)
    // Turn 1 belongs to the first participant — the creator, who just acted —
    // so the job skips it (self_turn). Enqueued anyway so that rule is
    // enforced in one place, server-side, whatever the join order.
    await enqueueTurnEmail(env, story.id, 0, userId)
    return { success: true, data: { status: 'writing' } }
  },

  async getPreviousLine({ userId, params, tools }) {
    const story = await loadStory(tools, params.storyId)
    if (!isStory(story)) return story
    const denied = checkTurn(story, userId)
    if (denied) return denied
    if (story.turnIndex === 0) return { success: true, data: { line: null } }
    const prev = await findLine(tools, story.id, story.turnIndex - 1)
    if (!prev) return fail('previous_line_missing', 'Previous line not found')
    // Only the text of the single previous line — no author, no history.
    return { success: true, data: { line: String(prev.data.text ?? '') } }
  },

  async submitLine({ userId, params, tools, env }) {
    const story = await loadStory(tools, params.storyId)
    if (!isStory(story)) return story
    const denied = checkTurn(story, userId)
    if (denied) return denied
    const text = typeof params.text === 'string' ? params.text.trim() : ''
    if (text === '') return fail('empty_line', 'Line cannot be empty')
    if (text.length > MAX_LINE_LENGTH) {
      return fail('line_too_long', `Line must be at most ${MAX_LINE_LENGTH} characters`)
    }
    const turn = story.turnIndex

    // 1. Insert first. uniqueOn ['storyId','turn'] makes this the turn lock.
    const inserted = await tools.create('lines', { storyId: story.id, turn, authorId: userId, text })
    if (!inserted.success) {
      // The record room's uniqueOn refusal reads "Duplicate: a record with …".
      if (!inserted.error.startsWith('Duplicate:')) return fail('insert_failed', inserted.error)
      // Lost the race, or an earlier submit inserted but failed to advance.
      // Repair: if the story is still on this turn and its line exists,
      // advance it (absolute value, so concurrent repairs agree).
      const fresh = await loadStory(tools, story.id)
      if (isStory(fresh) && fresh.status === 'writing' && fresh.turnIndex === turn) {
        await repairAdvance(tools, env, fresh, turn, userId)
      }
      return fail('turn_already_taken', 'A line for this turn was already submitted')
    }

    // 2. Advance (and 3. reveal on the last turn) only after the insert won.
    const advanced = await advancePast(tools, story, turn)
    if (!advanced.success) {
      return fail('advance_failed', 'Line saved but the turn did not advance; resubmitting repairs it')
    }
    const revealed = turn + 1 >= story.maxTurns
    // The turn change / reveal is committed above; side effects run in the background.
    if (revealed) await enqueueEnding(env, story.id, userId)
    else await enqueueTurnEmail(env, story.id, turn + 1, userId) // no email on reveal
    return { success: true, data: { turn: turn + 1, revealed } }
  },
}

export const actions: Record<string, ActionHandler<Env>> = {
  ...gameActions,
  // Build-time constant: `false` in every `vite build`, so the bundler drops
  // this spread and the test-actions module — the names do not ship.
  ...(__CORPSE_TEST_HOOKS__ ? testActions : {}),
}
