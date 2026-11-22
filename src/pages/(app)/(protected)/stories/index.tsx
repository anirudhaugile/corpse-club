/**
 * Lobby — the folding-sheet hero, then every story live from `stories` as a
 * paper note pinned to the desk, grouped by what it needs from you. Writes go
 * through the server actions; when a record changes, its note glides into its
 * new group.
 */

import {
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react'
import {
  BookOpen,
  DoorOpen,
  Feather,
  Hourglass,
  Inbox,
  Lightbulb,
  PenLine,
  Play,
  Plus,
  ScrollText,
  UserPlus,
  Users,
  type LucideProps,
} from 'lucide-react'
import { useQuery, useUser, useUserLookup } from 'deepspace'
import { Button, Input, Label } from '@/components/ui'
import { Hero } from '@/components/corpse/Hero'
import { Desk, WaxSeal, deckle, paperVars, seedOf, tilt, type SealVariant } from '@/components/corpse/paper'
import { callAction, currentPlayer, errorMessage, toStory, type Story, type StoryData } from '@/lib/corpse'

type Group = SealVariant
type Icon = ComponentType<LucideProps>

const GROUPS: { id: Group; title: string; empty: string; hint: string; icon: Icon }[] = [
  {
    id: 'turn',
    title: 'Your turn',
    empty: 'Nothing is waiting on your pen.',
    hint: 'Stories where the next line is yours show up here.',
    icon: Feather,
  },
  {
    id: 'open',
    title: 'Open to join',
    empty: 'No open sheets right now.',
    hint: 'Start one and invite someone to join.',
    icon: Inbox,
  },
  {
    id: 'progress',
    title: 'In progress',
    empty: 'No stories are mid-fold.',
    hint: "Started stories wait here while it's someone else's turn.",
    icon: Hourglass,
  },
  {
    id: 'done',
    title: 'Finished',
    empty: 'Nothing unfolded yet.',
    hint: 'Finished stories land here, ready to read top to bottom.',
    icon: ScrollText,
  },
]

const SEAL: Record<Group, { label: string; icon: Icon }> = {
  turn: { label: 'Your turn', icon: PenLine },
  open: { label: 'Open', icon: DoorOpen },
  progress: { label: 'In progress', icon: Hourglass },
  done: { label: 'Finished', icon: BookOpen },
}

const EASE = [0.22, 1, 0.36, 1] as const

function groupOf(story: Story, userId: string | undefined): Group {
  if (story.status === 'revealed') return 'done'
  if (story.status === 'open') return 'open'
  return userId !== undefined && currentPlayer(story) === userId ? 'turn' : 'progress'
}

export default function StoriesLobby() {
  const { user } = useUser()
  const { records, status } = useQuery<StoryData>('stories')
  const titleRef = useRef<HTMLInputElement>(null)
  const grouped = useMemo(() => {
    const out: Record<Group, Story[]> = { turn: [], open: [], progress: [], done: [] }
    for (const story of records.map(toStory).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      out[groupOf(story, user?.id)].push(story)
    }
    return out
  }, [records, user?.id])

  function startStory() {
    const input = titleRef.current
    if (!input) return
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    input.focus({ preventScroll: true })
  }

  return (
    // reducedMotion="user": Motion drops transform/layout animation when the
    // OS asks for reduced motion; CSS animations have their own media query.
    <MotionConfig reducedMotion="user">
      <div className="min-h-full text-foreground">
        <Hero>
          <Button size="lg" className="press gap-2" onClick={startStory}>
            <PenLine className="size-4" aria-hidden="true" />
            Start a story
          </Button>
        </Hero>
        <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <CreateStoryForm inputRef={titleRef} />

          <Desk className="mt-10 px-4 py-8 sm:px-8 sm:py-10">
            {status === 'loading' ? (
              <p className="desk-soft text-sm">Loading stories…</p>
            ) : status === 'error' ? (
              <p role="alert" className="desk-error text-sm">
                Could not load stories.
              </p>
            ) : (
              // One LayoutGroup so a note can glide from one group to another.
              <LayoutGroup>
                <div className="space-y-12" data-testid="story-list">
                  {GROUPS.map((g) => (
                    <StoryGroup key={g.id} title={g.title} icon={g.icon} count={grouped[g.id].length}>
                      {grouped[g.id].length === 0 ? (
                        <GroupEmpty text={g.empty} hint={g.hint} icon={g.icon} seed={seedOf(g.id)} />
                      ) : (
                        <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                          <AnimatePresence mode="popLayout" initial>
                            {grouped[g.id].map((story, i) => (
                              <StoryNote key={story.id} story={story} group={g.id} userId={user?.id} index={i} />
                            ))}
                          </AnimatePresence>
                        </ul>
                      )}
                    </StoryGroup>
                  ))}
                </div>
              </LayoutGroup>
            )}
          </Desk>
        </div>
      </div>
    </MotionConfig>
  )
}

/* ── Groups ────────────────────────────────────────────────────────────── */

function StoryGroup({
  title,
  icon: GroupIcon,
  count,
  children,
}: {
  title: string
  icon: Icon
  count: number
  children: ReactNode
}) {
  const id = `group-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="desk-soft mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
        <GroupIcon className="size-4" aria-hidden="true" />
        {title}
        <span className="rounded-full bg-black/25 px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--desk-fg)] [[data-theme=paper]_&]:bg-black/5">
          {count}
        </span>
      </h2>
      {children}
    </section>
  )
}

function GroupEmpty({ text, hint, icon: EmptyIcon, seed }: { text: string; hint: string; icon: Icon; seed: number }) {
  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="sheet-shadow max-w-md">
      <div
        className="paper flex items-start gap-4 px-5 py-5"
        style={{ ...paperVars(seed), clipPath: deckle(seed, { top: true, bottom: true }), rotate: `${tilt(seed, 0.6)}deg` }}
      >
        <EmptyIcon className="mt-1 size-5 shrink-0 text-[var(--ink-soft)]" aria-hidden="true" />
        <div>
          <p className="story-title text-lg text-[var(--ink)]">{text}</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">{hint}</p>
        </div>
      </div>
    </motion.div>
  )
}

/* ── Create ────────────────────────────────────────────────────────────── */

function CreateStoryForm({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(3)
  const [maxTurns, setMaxTurns] = useState(8)
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
    <form
      id="new-story"
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-card p-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.6)] sm:p-6"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Plus className="size-4" aria-hidden="true" />
        Start a new sheet
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-[1fr_6.5rem_6.5rem_auto] sm:items-end">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="story-title">Title</Label>
          <Input
            ref={inputRef}
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
            aria-describedby="story-tip"
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="story-turns">Lines</Label>
          <Input
            id="story-turns"
            type="number"
            min={2}
            value={maxTurns}
            aria-describedby="story-tip"
            onChange={(e) => setMaxTurns(Number(e.target.value))}
          />
        </div>
        <Button
          type="submit"
          className="press col-span-2 gap-2 sm:col-span-1"
          loading={busy}
          disabled={title.trim() === ''}
        >
          <Feather className="size-4" aria-hidden="true" />
          Create story
        </Button>
      </div>
      <p id="story-tip" className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lightbulb className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Tip: make lines a multiple of the player count so everyone writes the same amount.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

/* ── Note ──────────────────────────────────────────────────────────────── */

function StoryNote({
  story,
  group,
  userId,
  index,
}: {
  story: Story
  group: Group
  userId: string | undefined
  index: number
}) {
  const { getName } = useUserLookup()
  const [busy, setBusy] = useState<'join' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const joined = userId !== undefined && story.participants.includes(userId)
  const isCreator = userId !== undefined && story.creatorId === userId
  const full = story.participants.length >= story.maxPlayers
  const enough = story.participants.length >= 2
  const seal = SEAL[group]
  const seed = seedOf(story.id)

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
        ? `${story.maxTurns} lines planned`
        : `${story.maxTurns} lines`
  const cta =
    group === 'turn' ? 'Write your line' : group === 'done' ? 'Read it' : 'Open'

  return (
    <motion.li
      // Same layoutId across groups → the note glides to its new group.
      layout
      layoutId={`story-${story.id}`}
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.45, ease: EASE, delay: Math.min(index, 8) * 0.06 }}
      className="list-none"
    >
      <div className="note-card lift" style={{ '--rot': `${tilt(seed, 1.1)}deg` } as CSSProperties}>
        <span className="tape left-1/2 -top-2.5 -translate-x-1/2 rotate-[-3deg]" aria-hidden="true" />
        <div className="sheet-shadow">
          <div
            className="paper note flex min-h-52 flex-col px-5 pb-5 pt-6"
            style={{ ...paperVars(seed), clipPath: deckle(seed, { top: true, bottom: true, corner: 18 }) }}
          >
            <div className="flex items-center gap-2.5">
              <WaxSeal variant={group} icon={seal.icon} rotate={tilt(seed + 1, 12)} />
              <span className="font-hand text-lg leading-none text-[var(--ink)]">{seal.label}</span>
              {joined && <span className="ml-auto text-xs text-[var(--ink-soft)]">You're in</span>}
            </div>

            {/* The whole note is this link (stretched via ::after). */}
            <Link to={`/stories/${story.id}`} className="note-link mt-3 block">
              <h3 className="story-title ink text-2xl">{story.title || 'Untitled'}</h3>
              <span className="sr-only">, {seal.label}. {cta}.</span>
            </Link>

            <p className="mt-2 flex items-center gap-3 text-sm text-[var(--ink-soft)]">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" aria-hidden="true" />
                {story.participants.length}/{story.maxPlayers}
                <span className="sr-only"> players</span>
              </span>
              <span>{meta}</span>
            </p>

            <div className="mt-auto pt-4">
              {group === 'open' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {!joined &&
                    (full ? (
                      <span className="text-sm text-[var(--ink-soft)]">This story is full.</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="note-above press gap-1.5"
                        loading={busy === 'join'}
                        onClick={() => run('join')}
                      >
                        <UserPlus className="size-3.5" aria-hidden="true" />
                        Join
                      </Button>
                    ))}
                  {isCreator && (
                    <>
                      <Button
                        size="sm"
                        className="note-above press gap-1.5"
                        loading={busy === 'start'}
                        disabled={!enough}
                        aria-describedby={!enough ? `need-${story.id}` : undefined}
                        onClick={() => run('start')}
                      >
                        <Play className="size-3.5" aria-hidden="true" />
                        Start
                      </Button>
                      {!enough && (
                        <span id={`need-${story.id}`} className="text-xs text-[var(--ink-soft)]">
                          Need at least 2 players
                        </span>
                      )}
                    </>
                  )}
                  {joined && !isCreator && (
                    <span className="text-sm text-[var(--ink-soft)]">
                      Waiting for{' '}
                      <span className="font-hand text-lg text-[var(--ink)]">{getName(story.creatorId) ?? 'the host'}</span>{' '}
                      to start.
                    </span>
                  )}
                </div>
              ) : (
                <span aria-hidden="true" className="font-hand inline-flex items-center gap-1 text-lg text-[var(--ink)]">
                  {cta} →
                </span>
              )}
            </div>
            <AnimatePresence>
              {error && (
                <motion.p
                  role="alert"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="note-above mt-3 text-sm font-medium text-[#8a1c1c]"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.li>
  )
}
