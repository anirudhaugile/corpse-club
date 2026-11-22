import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'

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

type StoryStatus = 'open' | 'writing' | 'revealed'

interface Story {
  id: string
  title: string
  creatorId: string
  participants: string[]
  maxPlayers: number
  turnIndex: number
  maxTurns: number
  status: StoryStatus
  revealedText: string
}

function fail(code: string, error: string): ActionResult {
  return { success: false, code, error }
}

function parseParticipants(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
  if (typeof raw !== 'string' || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

async function loadStory(tools: ActionTools, storyId: unknown): Promise<Story | ActionResult> {
  if (typeof storyId !== 'string' || storyId === '') {
    return fail('invalid_story_id', 'storyId is required')
  }
  const res = await tools.get('stories', storyId)
  if (!res.success) return fail('story_not_found', 'Story not found')
  const d = res.data.record.data
  return {
    id: storyId,
    title: String(d.title ?? ''),
    creatorId: String(d.creatorId ?? ''),
    participants: parseParticipants(d.participants),
    maxPlayers: Number(d.maxPlayers ?? 0),
    turnIndex: Number(d.turnIndex ?? 0),
    maxTurns: Number(d.maxTurns ?? 0),
    status: String(d.status ?? '') as StoryStatus,
    revealedText: String(d.revealedText ?? ''),
  }
}

function isStory(value: Story | ActionResult): value is Story {
  return !('success' in value)
}

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

async function findLine(tools: ActionTools, storyId: string, turnIndex: number) {
  const res = await tools.query('lines', { where: { storyId, turn: turnIndex }, limit: 1 })
  if (!res.success) return null
  return res.data.records[0] ?? null
}

/**
 * Advance a story past `turnIndex` (whose line is known to exist). Writes the
 * ABSOLUTE next index, never an increment, so two callers repairing the same
 * turn converge on one value. On the final turn it assembles revealedText.
 */
async function advancePast(tools: ActionTools, story: Story, turnIndex: number): Promise<ActionResult> {
  const next = turnIndex + 1
  if (next < story.maxTurns) {
    return tools.update('stories', story.id, { turnIndex: next })
  }
  const all = await tools.query('lines', {
    where: { storyId: story.id },
    orderBy: 'turn',
    orderDir: 'asc',
    limit: story.maxTurns,
  })
  if (!all.success) return fail('reveal_failed', 'Could not assemble the story')
  const revealedText = all.data.records.map((r) => String(r.data.text ?? '')).join('\n')
  return tools.update('stories', story.id, { turnIndex: next, status: 'revealed', revealedText })
}

export const actions: Record<string, ActionHandler<Env>> = {
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

  async startStory({ userId, params, tools }) {
    const story = await loadStory(tools, params.storyId)
    if (!isStory(story)) return story
    if (story.creatorId !== userId) return fail('not_creator', 'Only the creator can start')
    if (story.status !== 'open') return fail('not_open', 'Story already started')
    if (story.participants.length < MIN_PLAYERS) {
      return fail('not_enough_players', `Need at least ${MIN_PLAYERS} players`)
    }
    const res = await tools.update('stories', story.id, { status: 'writing', turnIndex: 0 })
    if (!res.success) return fail('start_failed', res.error)
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

  async submitLine({ userId, params, tools }) {
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
        if (await findLine(tools, story.id, turn)) await advancePast(tools, fresh, turn)
      }
      return fail('turn_already_taken', 'A line for this turn was already submitted')
    }

    // 2. Advance (and 3. reveal on the last turn) only after the insert won.
    const advanced = await advancePast(tools, story, turn)
    if (!advanced.success) {
      return fail('advance_failed', 'Line saved but the turn did not advance; resubmitting repairs it')
    }
    return { success: true, data: { turn: turn + 1, revealed: turn + 1 >= story.maxTurns } }
  },
}
