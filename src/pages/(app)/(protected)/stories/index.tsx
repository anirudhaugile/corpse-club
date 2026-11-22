/**
 * Lobby — every story, live from the `stories` collection, plus create /
 * join / start. Writes go through the server actions; the list updates on
 * its own when the record changes.
 */

import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useUser } from 'deepspace'
import { Badge, Button, EmptyState, Input, Label } from '@/components/ui'
import { callAction, errorMessage, toStory, type Story, type StoryData } from '@/lib/corpse'

const STATUS_LABEL: Record<Story['status'], string> = {
  open: 'Open',
  writing: 'Writing',
  revealed: 'Revealed',
}
const STATUS_VARIANT = { open: 'info', writing: 'warning', revealed: 'success' } as const

export default function StoriesLobby() {
  const { user } = useUser()
  const { records, status } = useQuery<StoryData>('stories')
  const stories = useMemo(
    () => records.map(toStory).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records],
  )

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Stories</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Write one line at a time, seeing only the line before yours. The whole story is
          revealed when the last line is in.
        </p>

        <CreateStoryForm />

        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">All stories</h2>
          {status === 'loading' ? (
            <p className="text-sm text-muted-foreground">Loading stories…</p>
          ) : status === 'error' ? (
            <p className="text-sm text-destructive">Could not load stories.</p>
          ) : stories.length === 0 ? (
            <EmptyState title="No stories yet" description="Create the first one above." />
          ) : (
            <ul className="space-y-3" data-testid="story-list">
              {stories.map((story) => (
                <StoryRow key={story.id} story={story} userId={user?.id} />
              ))}
            </ul>
          )}
        </section>
      </div>
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
    <form onSubmit={onSubmit} className="mt-8 rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Start a new story</h2>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
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
            className="w-24"
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
            className="w-24"
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
      <Button type="submit" className="mt-4" loading={busy} disabled={title.trim() === ''}>
        Create story
      </Button>
    </form>
  )
}

function StoryRow({ story, userId }: { story: Story; userId: string | undefined }) {
  const [busy, setBusy] = useState<'join' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const joined = userId !== undefined && story.participants.includes(userId)
  const isCreator = userId !== undefined && story.creatorId === userId

  async function run(kind: 'join' | 'start') {
    setBusy(kind)
    setError(null)
    const res = await callAction(kind === 'join' ? 'joinStory' : 'startStory', { storyId: story.id })
    setBusy(null)
    if (!res.success) setError(errorMessage(res))
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link to={`/stories/${story.id}`} className="font-medium hover:underline">
            {story.title || 'Untitled'}
          </Link>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={STATUS_VARIANT[story.status]} size="sm">
              {STATUS_LABEL[story.status]}
            </Badge>
            <span>
              {story.participants.length} / {story.maxPlayers} players
            </span>
            <span>· {story.maxTurns} lines</span>
            {joined && <span>· you're in</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {story.status === 'open' && (
            <>
              {/* Shown to everyone so the server's refusals (already_joined,
                  story_full, not_creator) surface as readable messages. */}
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
          <Link
            to={`/stories/${story.id}`}
            className="inline-flex h-9 items-center rounded-md px-3 text-xs font-medium hover:bg-accent"
          >
            Open
          </Link>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  )
}
