/**
 * The folding-sheet hero, shared by the /stories lobby and the signed-out
 * /home landing. The sheet's fold loop is pure CSS (src/corpse.css,
 * `.hero-sheet`); panels are flat siblings so they can never crack apart.
 */

import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { paperVars } from './paper'

const EASE = [0.22, 1, 0.36, 1] as const

function InkLine({ width, seed }: { width: number; seed: number }) {
  // A hand-drawn-ish scribble standing in for unreadable writing.
  const w = 200 * width
  const d = `M4 14 C ${w * 0.2} ${6 + seed}, ${w * 0.35} ${20 - seed}, ${w * 0.5} 13 S ${w * 0.8} ${8 + seed}, ${w} 14`
  return (
    <svg className="hero-ink" viewBox="0 0 208 28" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

const PANELS = [
  { k: 1, width: 0.92, seed: 2 },
  { k: 2, width: 0.78, seed: 5 },
  { k: 3, width: 0.96, seed: 1 },
  { k: 4, width: 0.6, seed: 4 },
]

export function FoldingSheet() {
  return (
    <div className="hero-sheet" aria-hidden="true">
      {PANELS.map((p) => (
        <div key={p.k} className="hero-panel paper" data-k={p.k} style={paperVars(p.k * 7) as CSSProperties}>
          <div className="hero-panel-inner">
            <InkLine width={p.width} seed={p.seed} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Hero({
  title = 'One sheet. Many hands.',
  tagline = 'Write a line, fold it over, pass it on. Nobody sees the whole story until the last line unfolds.',
  children,
}: {
  title?: string
  tagline?: string
  /** Call-to-action buttons. */
  children: ReactNode
}) {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <div className="ambient" aria-hidden="true" />
      <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pb-20 md:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <p className="font-hand inline-flex items-center gap-2 text-xl text-muted-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
            exquisite corpse
          </p>
          <h1 id="hero-title" className="story-title mt-3 text-5xl sm:text-6xl">
            {title}
          </h1>
          <p className="mt-4 max-w-md text-base text-muted-foreground">{tagline}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">{children}</div>
        </motion.div>

        <motion.div
          className="flex justify-center md:justify-end"
          initial={{ opacity: 0, rotate: -4, y: 24 }}
          animate={{ opacity: 1, rotate: -2, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        >
          <FoldingSheet />
        </motion.div>
      </div>
    </section>
  )
}
