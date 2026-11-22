/**
 * Lobby — every story, live from the `stories` collection, grouped by what it
 * needs from you: Your turn / Open to join / In progress / Finished. Writes
 * go through the server actions; the groups update on their own when a
 * record changes.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useUser } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { callAction, currentPlayer, errorMessage, toStory, type Story, type StoryData } from '@/lib/corpse'

type Group = 'turn' | 'open' | 'progress' | 'done'

const GROUPS: { id: Group; title: string; empty: string; hint: string }[] = [
  {
    id: 'turn',
    title: 'Your turn',
    empty: 'Nothing is waiting on your pen.',
    hint: 'Stories where the next line is yours show up here.',
  },
  {
    id: 'open',
    title: 'Open to join',
    empty: 'No open sheets right now.',
    hint: 'Start one above and invite someone to join.',
  },
  {
    id: 'progress',
    title: 'In progress',
    empty: 'No stories are mid-fold.',
    hint: "Started stories appear here while it's someone else's turn.",
  },
  {
    id: 'done',
    title: 'Finished',
    empty: 'Nothing unfolded yet.',
    hint: 'Finished stories land here, ready to read top to bottom.',
  },
]

const CHIP: Record<Group, { className: string; label: string }> = {
  turn: { className: 'chip chip-turn', label: 'Your turn' },
  open: { className: 'chip chip-open', label: 'Open' },
  progress: { className: 'chip chip-progress', label: 'In progress' },
  done: { className: 'chip chip-done', label: 'Finished' },
}

function groupOf(story: Story, userId: string | undefined): Group {
  if (story.status === 'revealed') return 'done'
  if (story.status === 'open') return 'open'
  return userId !== undefined && currentPlayer(story) === userId ? 'turn' : 'progress'
}

export default function StoriesLobby() {
  const { user } = useUser()
  const { records, status } = useQuery<StoryData>('stories')
  const grouped = useMemo(() => {
    const out: Record<Group, Story[]> = { turn: [], open: [], progress: [], done: [] }
    for (const story of records.map(toStory).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      out[groupOf(story, user?.id)].push(story)
    }
    return out
  }, [records, user?.id])

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <header>
          <h1 className="story-title text-4xl sm:text-5xl">Stories</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            One sheet, many hands. Each player sees only the line before theirs; the rest stays
            folded away until the last line is in.
          </p>
        </header>

        <CreateStoryForm />

        {status === 'loading' ? (
          <p className="mt-12 text-sm text-muted-foreground">Loading stories…</p>
        ) : status === 'error' ? (
          <p role="alert" className="mt-12 text-sm text-destructive">
            Could not load stories.
          </p>
        ) : (
          <div className="mt-12 space-y-12" data-testid="story-list">
            {GROUPS.map((g) => (
              <StoryGroup key={g.id} title={g.title} count={grouped[g.id].length}>
                {grouped[g.id].length === 0 ? (
                  <GroupEmpty text={g.empty} hint={g.hint} />
                ) : (
                  <ul className="grid gap-4 sm:grid-cols-2">
                    {grouped[g.id].map((story) => (
                      <StoryCard key={story.id} story={story} group={g.id} userId={user?.id} />
                    ))}
                  </ul>
                )}
              </StoryGroup>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StoryGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = `group-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-4 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="font-normal tabular-nums">({count})</span>
      </h2>
      {children}
    </section>
  )
}

function GroupEmpty({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-5 py-6">
      <p className="story-title text-lg text-foreground">{text}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}

function CreateStoryForm() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(3)
  const [maxTurns, setMaxTurns] = useState(6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await callAction<{ storyId: string }>('createStory', { title, maxPlayers, maxTurns })
    setBusy(false)
    if (!res.success) return setError(errorMessage(res))
    setTitle('')
    navigate(`/stories/${res.data.storyId}`)
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-base font-semibold">Start a new sheet</h2>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-[1fr_6rem_6rem]">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="story-title">Title</Label>
          <Input
            id="story-title"
            value={title}
            maxLength={100}
            placeholder="The moon's borrowed coat"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="story-players">Players</Label>
          <Input
            id="story-players"
            type="number"
            min={2}
            max={8}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="story-turns">Lines</Label>
          <Input
            id="story-turns"
            type="number"
            min={2}
            max={40}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value))}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-4 w-full sm:w-auto" loading={busy} disabled={title.trim() === ''}>
        Create story
      </Button>
    </form>
  )
}

function StoryCard({ story, group, userId }: { story: Story; group: Group; userId: string | undefined }) {
  const [busy, setBusy] = useState<'join' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const joined = userId !== undefined && story.participants.includes(userId)
  const isCreator = userId !== undefined && story.creatorId === userId
  const chip = CHIP[group]

  async function run(kind: 'join' | 'start') {
    setBusy(kind)
    setError(null)
    const res = await callAction(kind === 'join' ? 'joinStory' : 'startStory', { storyId: story.id })
    setBusy(null)
    if (!res.success) setError(errorMessage(res))
  }

  const meta =
    story.status === 'writing'
      ? `Line ${Math.min(story.turnIndex + 1, story.maxTurns)} of ${story.maxTurns}`
      : story.status === 'open'
        ? `${story.participants.length} of ${story.maxPlayers} players`
        : `${story.maxTurns} lines · ${story.participants.length} players`

  return (
    <li
      className="flex flex-col rounded-xl border border-border bg-card p-5"
      style={
        group === 'turn'
          ? { borderColor: 'color-mix(in srgb, var(--chip-turn-fg) 55%, transparent)' }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className={chip.className}>{chip.label}</span>
        {joined && <span className="text-xs text-muted-foreground">You're in</span>}
      </div>
      <Link to={`/stories/${story.id}`} className="focus-ring mt-3 block">
        <h3 className="story-title text-2xl text-card-foreground">{story.title || 'Untitled'}</h3>
      </Link>
      <p className="mt-2 text-sm text-muted-foreground">{meta}</p>

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {group === 'turn' && (
          <Link
            to={`/stories/${story.id}`}
            className="focus-ring inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
          >
            Write your line
          </Link>
        )}
        {group === 'open' && (
          <>
            {/* Shown to everyone so the server's refusals (already_joined,
                story_full) surface as readable messages. */}
            <Button size="sm" variant="secondary" loading={busy === 'join'} onClick={() => run('join')}>
              Join
            </Button>
            {/* Any participant sees Start; a non-creator gets not_creator. */}
            {(isCreator || joined) && (
              <Button size="sm" loading={busy === 'start'} onClick={() => run('start')}>
                Start
              </Button>
            )}
          </>
        )}
        {group !== 'turn' && (
          <Link
            to={`/stories/${story.id}`}
            className="focus-ring inline-flex h-9 items-center rounded-md px-3 text-xs font-medium hover:bg-accent"
          >
            {group === 'done' ? 'Read it' : 'Open'}
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  )
}
