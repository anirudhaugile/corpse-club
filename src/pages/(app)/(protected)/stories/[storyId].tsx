/**
 * Story room — the folded sheet.
 *
 * Turn state comes from the live `stories` record. The previous line comes
 * ONLY from the getPreviousLine action, which the server refuses unless it is
 * the caller's turn. Earlier lines are drawn as folded-away strip edges whose
 * count is derived from `turnIndex` — never from line content, which the
 * client cannot read. Nothing of the story's text is shown off-turn until the
 * story is revealed.
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePresenceRoom, useQuery, useUser, useUserLookup } from 'deepspace'
import { Button } from '@/components/ui'
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
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Link to="/stories" className="focus-ring text-sm text-muted-foreground hover:text-foreground">
          ← All stories
        </Link>
        {status === 'loading' ? (
          <p className="mt-10 text-sm text-muted-foreground">Loading story…</p>
        ) : !story ? (
          <p className="mt-10 text-sm text-muted-foreground">This story doesn't exist.</p>
        ) : (
          <>
            <header className="mt-6 text-center">
              <h1 className="story-title text-3xl sm:text-5xl">{story.title || 'Untitled'}</h1>
              <StatusLine story={story} />
            </header>
            <Participants story={story} userId={user?.id} />
            <div className="mt-10">
              {story.status === 'open' && <OpenPanel story={story} userId={user?.id} />}
              {story.status === 'writing' && <WritingPanel story={story} userId={user?.id} />}
              {story.status === 'revealed' && <RevealView story={story} />}
            </div>
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
        : `Unfolded · ${story.maxTurns} lines`
  return <p className="mt-3 text-sm text-muted-foreground">{text}</p>
}

function Participants({ story, userId }: { story: Story; userId: string | undefined }) {
  const { getName } = useUserLookup()
  // One presence room per story; peers excludes yourself.
  const { peers } = usePresenceRoom(`corpse-story-${story.id}`)
  const online = new Set(peers.map((p) => p.userId))
  if (userId) online.add(userId)
  const turnOf = story.status === 'writing' ? currentPlayer(story) : undefined

  return (
    <section aria-label="Players" className="mt-8">
      <ol className="flex flex-wrap justify-center gap-2" data-testid="participants">
        {story.participants.map((id, i) => {
          const isOnline = online.has(id)
          const writing = id === turnOf
          return (
            <li
              key={id}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                writing ? 'chip-turn border-transparent font-medium' : 'border-border text-foreground'
              }`}
            >
              <span
                className={`size-2 rounded-full ${isOnline ? 'bg-success' : 'bg-muted-foreground/40'}`}
                aria-hidden="true"
              />
              <span className="tabular-nums opacity-70">{i + 1}</span>
              <span>
                {getName(id) ?? 'Player'}
                {id === userId && ' (you)'}
              </span>
              <span className="sr-only">
                {isOnline ? ', online' : ', offline'}
                {id === story.creatorId ? ', host' : ''}
                {writing ? ', writing now' : ''}
              </span>
              {id === story.creatorId && (
                <span aria-hidden="true" className="text-xs opacity-70">
                  host
                </span>
              )}
              {writing && (
                <span aria-hidden="true" className="text-xs">
                  ✎
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Folded-away strips: edges only. Count comes from turn state, not content. */
function FoldStack({ count }: { count: number }) {
  if (count <= 0) return null
  const shown = Math.min(count, 6)
  return (
    <div
      className="fold-stack"
      role="img"
      aria-label={`${count} earlier ${count === 1 ? 'line' : 'lines'} folded away`}
    >
      {Array.from({ length: shown }, (_, i) => (
        // Oldest folds are tucked deepest.
        <div key={i} className="fold-edge" style={{ '--depth': shown - 1 - i } as CSSProperties} />
      ))}
      {count > shown && <p className="fold-more">+{count - shown} more folded</p>}
    </div>
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
    <div className="sheet">
      <div className="sheet-body">
        <div className="paper strip text-center">
          <p className="strip-label">A blank sheet</p>
          <p className="mt-2 italic text-[var(--ink-soft)]">
            {joined
              ? 'Waiting for the host to start. Turn order is join order.'
              : 'Join to take a turn. Turn order is join order.'}
          </p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
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
        <p role="alert" className="mt-3 text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

type PreviousLine =
  | { state: 'loading' }
  | { state: 'ready'; line: string | null }
  | { state: 'error'; message: string }

function WritingPanel({ story, userId }: { story: Story; userId: string | undefined }) {
  const turnOf = currentPlayer(story)
  const isParticipant = userId !== undefined && story.participants.includes(userId)
  const myTurn = isParticipant && turnOf === userId

  if (!myTurn) return <WaitingSheet story={story} turnOf={turnOf} isParticipant={isParticipant} />
  // Keyed by turn so the fetched line and draft reset every turn.
  return <YourTurn key={`${story.id}:${story.turnIndex}`} story={story} />
}

function WaitingSheet({
  story,
  turnOf,
  isParticipant,
}: {
  story: Story
  turnOf: string | undefined
  isParticipant: boolean
}) {
  const { getName } = useUserLookup()
  const name = (turnOf && getName(turnOf)) || 'the next player'
  return (
    // Deliberately no story text here — not even the previous line.
    <div className="sheet" data-testid="waiting">
      <div className="sheet-breathe">
        <FoldStack count={story.turnIndex} />
        <div className="sheet-body">
          <div className="paper strip" aria-hidden="true">
            <div className="h-16" />
          </div>
        </div>
      </div>
      <p className="mt-6 text-center text-base text-foreground" aria-live="polite">
        {isParticipant ? (
          <>
            Waiting for <span className="font-semibold">{name}</span>
            <span className="waiting-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </>
        ) : (
          "You're watching. The story appears here once it's unfolded."
        )}
      </p>
      {isParticipant && (
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Writing line {story.turnIndex + 1} of {story.maxTurns}
        </p>
      )}
    </div>
  )
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
  const remaining = MAX_LINE_LENGTH - text.length
  return (
    <form onSubmit={onSubmit} className="sheet" data-testid="your-turn">
      <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Your turn
      </h2>
      {/* Lines before the previous one are folded away. */}
      <FoldStack count={Math.max(0, story.turnIndex - 1)} />
      <div className="sheet-body">
        <div className="paper strip">
          {previous.state === 'loading' && <p className="italic text-[var(--ink-soft)]">Unfolding…</p>}
          {previous.state === 'error' && (
            <p role="alert" className="font-sans text-sm text-[#8a1c1c]">
              {previous.message}
            </p>
          )}
          {previous.state === 'ready' &&
            (previous.line === null ? (
              <>
                <p className="strip-label">First line</p>
                <p className="mt-1 italic text-[var(--ink-soft)]">You start the story.</p>
              </>
            ) : (
              <>
                <p className="strip-label">The line before yours</p>
                <p className="mt-1" data-testid="previous-line">
                  {previous.line}
                </p>
              </>
            ))}
        </div>
        <div className="paper strip strip-write">
          <label htmlFor="next-line" className="strip-label">
            Your line
          </label>
          <textarea
            id="next-line"
            rows={3}
            maxLength={MAX_LINE_LENGTH}
            value={text}
            placeholder="Continue the story…"
            aria-describedby="next-line-count"
            onChange={(e) => setText(e.target.value)}
          />
          <p id="next-line-count" className="strip-count mt-1 text-right" data-near={remaining <= 20}>
            {text.length} / {MAX_LINE_LENGTH}
            <span className="sr-only"> characters</span>
          </p>
        </div>
      </div>
      <div className="mt-6 flex flex-col items-center gap-2">
        <Button type="submit" loading={busy} disabled={trimmed === '' || previous.state !== 'ready'}>
          Fold it over &amp; pass it on
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}

function RevealView({ story }: { story: Story }) {
  const lines = story.revealedText.split('\n')
  return (
    <section className="space-y-10" data-testid="reveal" aria-label="The finished story">
      <div className="sheet">
        <div className="sheet-body overflow-hidden">
          {lines.map((line, i) => (
            <p key={i} className="paper strip unfold" style={{ '--i': i } as CSSProperties}>
              {line}
            </p>
          ))}
        </div>
      </div>
      {/* PLACEHOLDER — AI-generated title and ending go here (not built yet). */}
      <div
        className="sheet rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground"
        data-testid="ai-placeholder"
      >
        <p className="font-semibold text-foreground">Placeholder: AI title &amp; ending</p>
        <p className="mt-1">
          A generated title and closing line will appear here in a later step. Nothing is generated
          yet.
        </p>
      </div>
    </section>
  )
}
