/**
 * Story room — participants, presence, whose turn it is, and (only on your
 * turn) the single previous line plus a box to write the next one.
 *
 * Turn state comes from the live `stories` record. The previous line comes
 * ONLY from the getPreviousLine action, which the server refuses unless it is
 * the caller's turn; nothing of the story's text is shown otherwise until
 * the story is revealed.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePresenceRoom, useQuery, useUser, useUserLookup } from 'deepspace'
import { Badge, Button, Label, Textarea } from '@/components/ui'
import {
  MAX_LINE_LENGTH,
  callAction,
  currentPlayer,
  errorMessage,
  toStory,
  type Story,
  type StoryData,
} from '@/lib/corpse'

export default function StoryRoom() {
  const { storyId = '' } = useParams<{ storyId: string }>()
  const { user } = useUser()
  const { records, status } = useQuery<StoryData>('stories')
  const story = useMemo(() => {
    const record = records.find((r) => r.recordId === storyId)
    return record ? toStory(record) : null
  }, [records, storyId])

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link to="/stories" className="text-sm text-muted-foreground hover:text-foreground">
          ← All stories
        </Link>
        {status === 'loading' ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading story…</p>
        ) : !story ? (
          <p className="mt-8 text-sm text-muted-foreground">This story doesn't exist.</p>
        ) : (
          <>
            <header className="mt-6">
              <h1 className="text-3xl font-bold tracking-tight">{story.title || 'Untitled'}</h1>
              <StatusLine story={story} />
            </header>
            <Participants story={story} userId={user?.id} />
            {story.status === 'open' && <OpenPanel story={story} userId={user?.id} />}
            {story.status === 'writing' && <WritingPanel story={story} userId={user?.id} />}
            {story.status === 'revealed' && <RevealView story={story} />}
          </>
        )}
      </div>
    </div>
  )
}

function StatusLine({ story }: { story: Story }) {
  const text =
    story.status === 'open'
      ? 'Waiting for players'
      : story.status === 'writing'
        ? `Line ${Math.min(story.turnIndex + 1, story.maxTurns)} of ${story.maxTurns}`
        : 'Finished'
  return <p className="mt-2 text-sm text-muted-foreground">{text}</p>
}

function Participants({ story, userId }: { story: Story; userId: string | undefined }) {
  const { getName } = useUserLookup()
  // One presence room per story; peers excludes yourself.
  const { peers } = usePresenceRoom(`corpse-story-${story.id}`)
  const online = new Set(peers.map((p) => p.userId))
  if (userId) online.add(userId)
  const turnOf = story.status === 'writing' ? currentPlayer(story) : undefined

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">
        Players ({story.participants.length} / {story.maxPlayers})
      </h2>
      <ol className="space-y-2" data-testid="participants">
        {story.participants.map((id, i) => (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span
              aria-label={online.has(id) ? 'online' : 'offline'}
              className={`size-2 rounded-full ${online.has(id) ? 'bg-success' : 'bg-muted-foreground/30'}`}
            />
            <span className="text-muted-foreground">{i + 1}.</span>
            <span>{getName(id) ?? 'Player'}</span>
            {id === userId && <span className="text-muted-foreground">(you)</span>}
            {id === story.creatorId && (
              <Badge variant="outline" size="sm">
                host
              </Badge>
            )}
            {id === turnOf && (
              <Badge variant="warning" size="sm">
                writing now
              </Badge>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function OpenPanel({ story, userId }: { story: Story; userId: string | undefined }) {
  const [busy, setBusy] = useState<'join' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const joined = userId !== undefined && story.participants.includes(userId)

  async function run(kind: 'join' | 'start') {
    setBusy(kind)
    setError(null)
    const res = await callAction(kind === 'join' ? 'joinStory' : 'startStory', { storyId: story.id })
    setBusy(null)
    if (!res.success) setError(errorMessage(res))
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-6">
      <p className="text-sm text-muted-foreground">
        {joined
          ? 'Waiting for the host to start. Turn order is join order.'
          : 'Join to take a turn. Turn order is join order.'}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" loading={busy === 'join'} onClick={() => run('join')}>
          Join
        </Button>
        {joined && (
          <Button loading={busy === 'start'} onClick={() => run('start')}>
            Start story
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

type PreviousLine =
  | { state: 'loading' }
  | { state: 'ready'; line: string | null }
  | { state: 'error'; message: string }

function WritingPanel({ story, userId }: { story: Story; userId: string | undefined }) {
  const { getName } = useUserLookup()
  const turnOf = currentPlayer(story)
  const isParticipant = userId !== undefined && story.participants.includes(userId)
  const myTurn = isParticipant && turnOf === userId

  if (!myTurn) {
    // Deliberately no story text here — not even the previous line.
    return (
      <section className="mt-6 rounded-lg border border-border bg-card p-6" data-testid="waiting">
        <p className="text-sm text-muted-foreground">
          {isParticipant
            ? `Waiting for ${turnOf ? (getName(turnOf) ?? 'the next player') : 'the next player'} to write line ${story.turnIndex + 1}.`
            : "You're watching. The story will appear here once it's revealed."}
        </p>
      </section>
    )
  }
  // Keyed by turn so the fetched line and draft reset every turn.
  return <YourTurn key={`${story.id}:${story.turnIndex}`} story={story} />
}

function YourTurn({ story }: { story: Story }) {
  const [previous, setPrevious] = useState<PreviousLine>({ state: 'loading' })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void callAction<{ line: string | null }>('getPreviousLine', { storyId: story.id }).then((res) => {
      if (cancelled) return
      setPrevious(res.success ? { state: 'ready', line: res.data.line } : { state: 'error', message: errorMessage(res) })
    })
    return () => {
      cancelled = true
    }
  }, [story.id])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await callAction('submitLine', { storyId: story.id, text })
    setBusy(false)
    // On success the live record advances the turn and this panel unmounts.
    if (!res.success) setError(errorMessage(res))
  }

  const trimmed = text.trim()
  return (
    <section className="mt-6 rounded-lg border border-primary/40 bg-card p-6" data-testid="your-turn">
      <h2 className="text-lg font-semibold">Your turn</h2>
      <div className="mt-4">
        {previous.state === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
        {previous.state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {previous.message}
          </p>
        )}
        {previous.state === 'ready' &&
          (previous.line === null ? (
            <p className="text-sm text-muted-foreground">You start the story.</p>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">The line before yours</p>
              <blockquote className="mt-1 border-l-2 border-border pl-3 italic" data-testid="previous-line">
                {previous.line}
              </blockquote>
            </>
          ))}
      </div>
      <form onSubmit={onSubmit} className="mt-5 space-y-2">
        <Label htmlFor="next-line">Your line</Label>
        <Textarea
          id="next-line"
          rows={3}
          maxLength={MAX_LINE_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {text.length} / {MAX_LINE_LENGTH}
          </span>
          <Button type="submit" loading={busy} disabled={trimmed === '' || previous.state !== 'ready'}>
            Submit line
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}

function RevealView({ story }: { story: Story }) {
  const lines = story.revealedText.split('\n')
  return (
    <section className="mt-6 space-y-6" data-testid="reveal">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">The finished story</h2>
        <div className="space-y-2 font-serif text-lg leading-relaxed">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
      {/* PLACEHOLDER — AI-generated title and ending go here (not built yet). */}
      <div
        className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground"
        data-testid="ai-placeholder"
      >
        <p className="font-medium">Placeholder: AI title &amp; ending</p>
        <p className="mt-1">
          A generated title and closing line will appear here in a later step. Nothing is
          generated yet.
        </p>
      </div>
    </section>
  )
}
