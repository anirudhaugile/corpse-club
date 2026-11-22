/**
 * Story room — a folded sheet on a desk.
 *
 * Turn state comes from the live `stories` record. The previous line comes
 * ONLY from the getPreviousLine action, which the server refuses unless it is
 * the caller's turn. Folded edges and the progress rail are derived from
 * `turnIndex` — never from line content, which the client cannot read.
 * Nothing of the story's text is shown off-turn until it is revealed.
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import {
  ArrowLeft,
  Crown,
  Feather,
  Hourglass,
  Play,
  ScrollText,
  Send,
  UserPlus,
  Users,
  WandSparkles,
} from 'lucide-react'
import { usePresenceRoom, useQuery, useUser, useUserLookup } from 'deepspace'
import { Avatar, AvatarFallback, AvatarImage, Button } from '@/components/ui'
import {
  Desk,
  FountainPen,
  InkText,
  PaperClip,
  deckle,
  paperVars,
  seedOf,
  tilt,
} from '@/components/corpse/paper'
import {
  MAX_LINE_LENGTH,
  callAction,
  currentPlayer,
  errorMessage,
  toStory,
  type Story,
  type StoryData,
} from '@/lib/corpse'

const EASE = [0.22, 1, 0.36, 1] as const

export default function StoryRoom() {
  const { storyId = '' } = useParams<{ storyId: string }>()
  const { user } = useUser()
  const { records, status } = useQuery<StoryData>('stories')
  const story = useMemo(() => {
    const record = records.find((r) => r.recordId === storyId)
    return record ? toStory(record) : null
  }, [records, storyId])

  return (
    <MotionConfig reducedMotion="user">
      {/* Page transition into the room. */}
      <motion.div
        className="relative isolate min-h-full text-foreground"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div className="ambient" aria-hidden="true" />
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          <Link
            to="/stories"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            All stories
          </Link>
          {status === 'loading' ? (
            <p className="mt-10 text-sm text-muted-foreground">Loading story…</p>
          ) : !story ? (
            <p className="mt-10 text-sm text-muted-foreground">This story doesn't exist.</p>
          ) : (
            <>
              <header className="mt-6 text-center">
                <h1 className="story-title text-4xl sm:text-5xl">{story.title || 'Untitled'}</h1>
              </header>
              <ProgressRail story={story} />
              <Players story={story} userId={user?.id} />

              <Desk className="mt-10 overflow-hidden px-3 py-10 sm:px-10 sm:py-12">
                {/* Desk prop: a fountain pen beside the sheet, only where there's room. */}
                <FountainPen
                  className="desk-prop hidden h-56 w-10 lg:block"
                  style={{ right: '1.25rem', top: '3rem', rotate: '18deg' }}
                />
                <div className="relative z-[1]">
                  {story.status !== 'revealed' && <RulesNote seed={seedOf(story.id + 'rules')} />}
                  <AnimatePresence mode="wait">
                    {story.status === 'open' && <OpenPanel key="open" story={story} userId={user?.id} />}
                    {story.status === 'writing' && <WritingPanel key="writing" story={story} userId={user?.id} />}
                    {story.status === 'revealed' && <RevealView key="revealed" story={story} />}
                  </AnimatePresence>
                </div>
              </Desk>
            </>
          )}
        </div>
      </motion.div>
    </MotionConfig>
  )
}

/* ── Progress rail: turn N of M as folded segments ─────────────────────── */

function ProgressRail({ story }: { story: Story }) {
  const total = Math.max(story.maxTurns, 1)
  const done = story.status === 'revealed' ? total : Math.min(story.turnIndex, total)
  const label =
    story.status === 'open'
      ? 'Waiting for players'
      : story.status === 'writing'
        ? `Turn ${Math.min(story.turnIndex + 1, total)} of ${total}`
        : `Unfolded · ${total} lines`
  return (
    <div className="mx-auto mt-6 max-w-md">
      <p className="mb-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        {story.status === 'writing' ? (
          <Feather className="size-4" aria-hidden="true" />
        ) : story.status === 'revealed' ? (
          <ScrollText className="size-4" aria-hidden="true" />
        ) : (
          <Hourglass className="size-4" aria-hidden="true" />
        )}
        {label}
      </p>
      <div
        className="rail"
        role="progressbar"
        aria-label="Story progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={label}
      >
        {Array.from({ length: total }, (_, i) => {
          const state =
            story.status === 'revealed'
              ? 'is-revealed'
              : i < story.turnIndex
                ? 'is-done'
                : i === story.turnIndex && story.status === 'writing'
                  ? 'is-current'
                  : 'is-next'
          return <span key={i} className={`rail-seg ${state}`} />
        })}
      </div>
    </div>
  )
}

/* ── Players: avatars, presence, live "writing now" pulse ──────────────── */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase()
}

function Players({ story, userId }: { story: Story; userId: string | undefined }) {
  const { getUser } = useUserLookup()
  // One presence room per story; peers excludes yourself.
  const { peers } = usePresenceRoom(`corpse-story-${story.id}`)
  const online = new Set(peers.map((p) => p.userId))
  if (userId) online.add(userId)
  const turnOf = story.status === 'writing' ? currentPlayer(story) : undefined

  return (
    <section aria-labelledby="players-heading" className="mt-8">
      <h2 id="players-heading" className="sr-only">
        Players
      </h2>
      <ol className="flex flex-wrap justify-center gap-x-5 gap-y-4" data-testid="participants">
        {story.participants.map((id, i) => {
          const info = getUser(id)
          const name = info?.name || 'Player'
          const isOnline = online.has(id)
          const writing = id === turnOf
          const host = id === story.creatorId
          return (
            <motion.li
              key={id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, ease: EASE }}
              className="flex w-20 flex-col items-center gap-1.5 text-center"
            >
              <span className="avatar-ring" data-writing={writing}>
                <Avatar className={`size-12 ${writing ? 'ring-2 ring-[var(--chip-turn-fg)]' : 'ring-1 ring-border'}`}>
                  {info?.imageUrl && <AvatarImage src={info.imageUrl} alt="" />}
                  <AvatarFallback className="bg-muted text-sm font-semibold text-foreground">
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
                <span
                  aria-hidden="true"
                  className={`absolute bottom-0 right-0 size-3 rounded-full border-2 border-background ${
                    isOnline ? 'bg-success' : 'bg-muted-foreground/50'
                  }`}
                />
                {host && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1.5 -left-1.5 grid size-5 place-items-center rounded-full bg-card text-[var(--chip-turn-fg)] ring-1 ring-border"
                  >
                    <Crown className="size-3" />
                  </span>
                )}
              </span>
              <span className={`w-full truncate text-foreground ${host ? 'font-hand text-base leading-tight' : 'text-xs'}`}>
                {name}
                {id === userId && <span className="font-sans text-xs"> (you)</span>}
              </span>
              {writing && (
                <span className="chip chip-turn px-2! py-0! text-[0.6875rem]!">
                  <Feather className="size-3" aria-hidden="true" />
                  writing
                </span>
              )}
              <span className="sr-only">
                {`Player ${i + 1}`}
                {isOnline ? ', online' : ', offline'}
                {host ? ', host' : ''}
                {writing ? ', writing now' : ''}
              </span>
            </motion.li>
          )
        })}
      </ol>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden="true" />
        {story.participants.length} of {story.maxPlayers} players · turn order is join order
      </p>
    </section>
  )
}

/* ── Paper pieces ──────────────────────────────────────────────────────── */

/** House rules, as a small note taped to the desk. */
function RulesNote({ seed }: { seed: number }) {
  return (
    <aside aria-label="How to play" className="relative mx-auto mb-10 max-w-sm" style={{ rotate: `${tilt(seed, 1.4)}deg` }}>
      <span className="tape left-6 -top-2.5 rotate-[-6deg]" aria-hidden="true" />
      <div className="sheet-shadow">
        <div className="paper px-5 pb-4 pt-5" style={{ ...paperVars(seed), clipPath: deckle(seed, { top: true, bottom: true }) }}>
          <p className="font-hand text-xl leading-none text-[var(--ink)]">House rules</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            Write one sentence. Leave a hook for the next writer. You'll only ever see the line before yours.
          </p>
        </div>
      </div>
    </aside>
  )
}

type StripProps = HTMLMotionProps<'div'> & {
  seed: number
  /** Outer edges are torn; inner edges meet at a crease. */
  first?: boolean
  last?: boolean
  /** Alternating valley / mountain creases. */
  index?: number
  children: ReactNode
}

/** One torn, creased, slightly tilted strip of the sheet. */
function Strip({ seed, first = false, last = false, index = 0, className = '', style, children, ...rest }: StripProps) {
  return (
    <motion.div
      className={`paper strip ${first ? '' : 'crease'} ${className}`}
      data-fold={index % 2 ? 'mountain' : 'valley'}
      style={{
        ...paperVars(seed),
        clipPath: deckle(seed, { top: first, bottom: last }),
        rotate: tilt(seed, 0.3),
        ...style,
      }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

/** Sheet frame: positions the paper clip and casts one shadow for all strips. */
function SheetFrame({ children, clip = true }: { children: ReactNode; clip?: boolean }) {
  return (
    <div className="sheet">
      {clip && (
        // Sits over the sheet's top padding only — never over text.
        <PaperClip className="desk-prop right-8 -top-5 z-10 h-11 w-4" style={{ rotate: '4deg' }} />
      )}
      <div className="sheet-shadow">{children}</div>
    </div>
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
        <motion.div
          key={i}
          className="fold-edge"
          style={{ '--depth': shown - 1 - i } as CSSProperties}
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ delay: i * 0.05, ease: EASE }}
        />
      ))}
      {count > shown && <p className="fold-more">+{count - shown} more folded</p>}
    </div>
  )
}

const panelMotion = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.4, ease: EASE },
}

/* ── Open: joining ─────────────────────────────────────────────────────── */

function OpenPanel({ story, userId }: { story: Story; userId: string | undefined }) {
  const { getName } = useUserLookup()
  const [busy, setBusy] = useState<'join' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const joined = userId !== undefined && story.participants.includes(userId)
  const isCreator = userId !== undefined && story.creatorId === userId
  const full = story.participants.length >= story.maxPlayers
  const enough = story.participants.length >= 2
  const seed = seedOf(story.id + 'open')

  async function run(kind: 'join' | 'start') {
    setBusy(kind)
    setError(null)
    const res = await callAction(kind === 'join' ? 'joinStory' : 'startStory', { storyId: story.id })
    setBusy(null)
    if (!res.success) setError(errorMessage(res))
  }

  return (
    <motion.div {...panelMotion}>
      <SheetFrame>
        <Strip seed={seed} first last className="text-center">
          <span className="strip-label">A blank sheet</span>
          {isCreator ? (
            <>
              <p className="mt-2 ink">Start when everyone's in</p>
              <p className="mt-1 font-sans text-sm text-[var(--ink-soft)]">
                {story.participants.length} of {story.maxPlayers} players joined
              </p>
              {!enough && (
                <p id="need-players" className="mt-2 font-sans text-sm font-semibold text-[#8a3b12]">
                  Need at least 2 players
                </p>
              )}
            </>
          ) : joined ? (
            <p className="mt-2 ink">
              Waiting for <span className="font-hand text-[1.6rem]">{getName(story.creatorId) ?? 'the host'}</span> to start.
            </p>
          ) : full ? (
            <p className="mt-2 italic text-[var(--ink-soft)]">This story is full.</p>
          ) : (
            <p className="mt-2 italic text-[var(--ink-soft)]">Join to take a turn.</p>
          )}
        </Strip>
      </SheetFrame>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {!joined && !full && (
          <Button variant="secondary" className="press gap-2" loading={busy === 'join'} onClick={() => run('join')}>
            <UserPlus className="size-4" aria-hidden="true" />
            Join
          </Button>
        )}
        {isCreator && (
          <Button
            className="press gap-2"
            loading={busy === 'start'}
            disabled={!enough}
            aria-describedby={!enough ? 'need-players' : undefined}
            onClick={() => run('start')}
          >
            <Play className="size-4" aria-hidden="true" />
            Start story
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="desk-error mt-3 text-center text-sm">
          {error}
        </p>
      )}
    </motion.div>
  )
}

/* ── Writing ───────────────────────────────────────────────────────────── */

type PreviousLine =
  | { state: 'loading' }
  | { state: 'ready'; line: string | null }
  | { state: 'error'; message: string }

function WritingPanel({ story, userId }: { story: Story; userId: string | undefined }) {
  const turnOf = currentPlayer(story)
  const isParticipant = userId !== undefined && story.participants.includes(userId)
  const myTurn = isParticipant && turnOf === userId

  return (
    <motion.div {...panelMotion}>
      <AnimatePresence mode="wait">
        {myTurn ? (
          // Keyed by turn so the fetched line and draft reset every turn.
          <YourTurn key={`turn-${story.turnIndex}`} story={story} />
        ) : (
          <WaitingSheet key={`wait-${story.turnIndex}`} story={story} turnOf={turnOf} isParticipant={isParticipant} />
        )}
      </AnimatePresence>
    </motion.div>
  )
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
  const seed = seedOf(`${story.id}:${story.turnIndex}:wait`)
  return (
    // Deliberately no story text here — not even the previous line.
    <motion.div data-testid="waiting" {...panelMotion}>
      <div className="sheet-breathe">
        <FoldStack count={story.turnIndex} />
        <SheetFrame clip={story.turnIndex === 0}>
          <Strip seed={seed} first={story.turnIndex === 0} last className="grid h-28 place-items-center" aria-hidden="true">
            <Feather className="size-6 text-[var(--ink-soft)] opacity-50" />
          </Strip>
        </SheetFrame>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-base" aria-live="polite">
        <Hourglass className="desk-soft size-4" aria-hidden="true" />
        {isParticipant ? (
          <span>
            Waiting for <span className="font-hand text-2xl leading-none">{name}</span>
            <span className="waiting-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </span>
        ) : (
          <span>You're watching. The story appears here once it unfolds.</span>
        )}
      </p>
    </motion.div>
  )
}

function YourTurn({ story }: { story: Story }) {
  const [previous, setPrevious] = useState<PreviousLine>({ state: 'loading' })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prevSeed = seedOf(`${story.id}:${story.turnIndex - 1}`)
  const writeSeed = seedOf(`${story.id}:${story.turnIndex}`)
  const first = story.turnIndex <= 1

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
    if (!res.success) return setError(errorMessage(res))
    // The strip folds back over and the sheet slides away; the live record
    // advancing the turn then swaps this panel for the waiting view.
    setSent(true)
  }

  const trimmed = text.trim()
  const remaining = MAX_LINE_LENGTH - text.length
  return (
    <motion.form
      onSubmit={onSubmit}
      data-testid="your-turn"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      // Give the fold-and-slide time to play before the panel swaps.
      exit={{ opacity: 0, transition: { delay: sent ? 0.95 : 0, duration: 0.25 } }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <h2 className="mb-5 flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--chip-turn-fg)]">
        <Feather className="size-4" aria-hidden="true" />
        Your turn
      </h2>
      {/* Lines before the previous one are folded away. */}
      <FoldStack count={Math.max(0, story.turnIndex - 1)} />
      <motion.div
        animate={sent ? { y: -36, scale: 0.94, opacity: 0 } : { y: 0, scale: 1, opacity: 1 }}
        transition={sent ? { delay: 0.5, duration: 0.45, ease: [0.55, 0, 0.75, 0.2] } : { duration: 0.3 }}
      >
        <SheetFrame clip={first}>
          {/* The previous strip unfolds toward you, hinged on its lower crease. */}
          <Strip
            seed={prevSeed}
            first={first}
            style={{ originY: 1 }}
            initial={{ rotateX: 100, opacity: 0.4 }}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 110, damping: 15, mass: 0.9 }}
            transformTemplate={(_, generated) => `perspective(900px) ${generated}`}
          >
            {previous.state === 'loading' && <p className="italic text-[var(--ink-soft)]">Unfolding…</p>}
            {previous.state === 'error' && (
              <p role="alert" className="font-sans text-sm text-[#8a1c1c]">
                {previous.message}
              </p>
            )}
            {previous.state === 'ready' &&
              (previous.line === null ? (
                <>
                  <span className="strip-label">First line</span>
                  <p className="mt-1 italic text-[var(--ink-soft)]">You start the story.</p>
                </>
              ) : (
                <>
                  <span className="strip-label">The line before yours</span>
                  <p className="mt-1" data-testid="previous-line">
                    <InkText text={previous.line} seed={prevSeed} />
                  </p>
                </>
              ))}
          </Strip>
          {/* Your strip slides out from under it — and on submit folds back over. */}
          <Strip
            seed={writeSeed}
            index={1}
            last
            className="strip-write ink"
            style={{ originY: 0 }}
            initial={{ opacity: 0, y: -28, rotateX: -55 }}
            animate={sent ? { rotateX: -176, y: -6, opacity: 1 } : { opacity: 1, y: 0, rotateX: 0 }}
            transition={
              sent
                ? { duration: 0.55, ease: [0.65, 0, 0.35, 1] }
                : { type: 'spring', stiffness: 140, damping: 18, delay: 0.35 }
            }
            transformTemplate={(_, generated) => `perspective(1000px) ${generated}`}
          >
            <label htmlFor="next-line" className="strip-label">
              Your line
            </label>
            <textarea
              id="next-line"
              rows={3}
              maxLength={MAX_LINE_LENGTH}
              value={text}
              disabled={sent}
              placeholder="Continue the story…"
              aria-describedby="next-line-count"
              onChange={(e) => setText(e.target.value)}
            />
            <p id="next-line-count" className="strip-count mt-1 text-right" data-near={remaining <= 20}>
              {text.length} / {MAX_LINE_LENGTH}
              <span className="sr-only"> characters</span>
            </p>
          </Strip>
        </SheetFrame>
      </motion.div>
      <div className="mt-6 flex flex-col items-center gap-2">
        <Button
          type="submit"
          size="lg"
          className="press gap-2"
          loading={busy}
          disabled={sent || trimmed === '' || previous.state !== 'ready'}
        >
          <Send className="size-4" aria-hidden="true" />
          {sent ? 'Passed on' : 'Fold it over & pass it on'}
        </Button>
        {error && (
          <p role="alert" className="desk-error text-sm">
            {error}
          </p>
        )}
      </div>
    </motion.form>
  )
}

/* ── Reveal: open the folded paper, strip by strip, then a flourish ─────── */

const STRIP_STAGGER = 0.42

function RevealView({ story }: { story: Story }) {
  const reduce = useReducedMotion()
  const lines = story.revealedText.split('\n')
  const [finished, setFinished] = useState(false)

  return (
    <motion.section className="space-y-10" data-testid="reveal" aria-label="The finished story" {...panelMotion}>
      <div className="relative">
        <SheetFrame>
          {lines.map((line, i) => {
            const seed = seedOf(`${story.id}:${i}`)
            const rot = tilt(seed, 0.3)
            // Accordion: alternate strips hinge on opposite edges and swing in
            // from opposite sides, overshoot a touch, then settle with a rustle.
            const dir = i % 2 === 0 ? 1 : -1
            return (
              <Strip
                key={i}
                seed={seed}
                index={i}
                first={i === 0}
                style={{ originY: i % 2 === 0 ? 0 : 1 }}
                initial={{ opacity: 0, rotateX: -150 * dir, rotate: rot }}
                animate={{
                  opacity: [0, 1, 1, 1],
                  rotateX: [-150 * dir, 9 * dir, -3 * dir, 0],
                  rotate: [rot, rot, rot - 0.8 * dir, rot],
                }}
                transition={{ duration: 1.05, times: [0, 0.55, 0.8, 1], ease: 'easeOut', delay: 0.3 + i * STRIP_STAGGER }}
                transformTemplate={(_, generated) => `perspective(1100px) ${generated}`}
                onAnimationComplete={i === lines.length - 1 ? () => setFinished(true) : undefined}
              >
                <InkText text={line} seed={seed} />
              </Strip>
            )
          })}
          <Strip seed={seedOf(story.id + 'fin')} index={lines.length} last className="flex items-center justify-end py-3!">
            <InkBlot show={finished || !!reduce} />
          </Strip>
        </SheetFrame>
        {finished && !reduce && <PaperFlutter />}
      </div>

      {/* PLACEHOLDER — AI-generated title and ending go here (not built yet). */}
      <motion.div
        className="sheet flex items-start gap-4 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--desk-fg-soft)_55%,transparent)] p-6 text-sm"
        data-testid="ai-placeholder"
        initial={{ opacity: 0 }}
        animate={{ opacity: finished || reduce ? 1 : 0.4 }}
        transition={{ duration: 0.6 }}
      >
        <WandSparkles className="desk-soft mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Placeholder: AI title &amp; ending</p>
          <p className="desk-soft mt-1">
            A generated title and closing line will appear here in a later step. Nothing is generated yet.
          </p>
        </div>
      </motion.div>
    </motion.section>
  )
}

/** The final flourish: an ink blot stamps "fin." at the foot of the sheet. */
function InkBlot({ show }: { show: boolean }) {
  return (
    <motion.div
      className="relative flex items-center gap-2 pr-1"
      initial={{ opacity: 0, scale: 0.4, rotate: -12 }}
      animate={show ? { opacity: 1, scale: 1, rotate: -6 } : { opacity: 0, scale: 0.4, rotate: -12 }}
      transition={{ type: 'spring', stiffness: 260, damping: 14 }}
    >
      <span className="font-hand ink text-3xl">fin.</span>
      <svg viewBox="0 0 64 64" className="size-10 text-[var(--ink)]" aria-hidden="true">
        <path
          fill="currentColor"
          d="M33 6c6 1 8 7 13 9s12 1 13 8-6 9-6 14 6 10 2 15-11 2-16 4-8 8-14 6-5-9-10-12-13-3-14-10 7-8 8-13-4-11 1-15 10 1 15-1 3-6 8-5z"
          opacity="0.9"
        />
        <circle cx="56" cy="10" r="2.5" fill="currentColor" />
        <circle cx="8" cy="52" r="1.8" fill="currentColor" />
      </svg>
    </motion.div>
  )
}

/** A few scraps of paper flutter down once, then disappear. Deterministic. */
function PaperFlutter() {
  const bits = Array.from({ length: 14 }, (_, i) => ({
    left: (i * 37) % 100,
    drift: ((i * 53) % 60) - 30,
    spin: ((i * 71) % 540) - 270,
    delay: (i % 7) * 0.08,
    size: 6 + ((i * 13) % 8),
  }))
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-6 h-0" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="paper absolute block rounded-[1px]"
          style={{ left: `${b.left}%`, width: b.size, height: b.size * 0.7 }}
          initial={{ y: 0, x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: [0, 120, 260], x: [0, b.drift, b.drift * 1.6], rotate: b.spin, opacity: [0, 1, 0] }}
          transition={{ duration: 2.2, delay: b.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}
