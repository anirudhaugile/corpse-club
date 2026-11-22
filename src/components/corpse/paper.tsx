/**
 * Handmade-paper primitives for the Exquisite Corpse pages: deterministic
 * torn edges, per-sheet texture variation, inked text, wax seals and two
 * small SVG desk props. Everything is seeded so a given strip or card always
 * looks the same across renders (no Math.random during render).
 */

import type { ComponentType, CSSProperties, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'

/** Small, fast, deterministic PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable numeric seed from any string (e.g. a record id). */
export function seedOf(value: string | number): number {
  const s = String(value)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const r2 = (n: number) => Math.round(n * 100) / 100

interface DeckleOptions {
  top?: boolean
  bottom?: boolean
  /** Cut a dog-ear of this many px from the top-right corner. */
  corner?: number
  /** Edge roughness in px. */
  amp?: number
}

/**
 * A torn ("deckled") edge as a clip-path polygon. Left and right edges are
 * always rough; top/bottom only when they are an outer edge of the sheet, so
 * strips stay flush where they meet at a crease.
 */
export function deckle(seed: number, { top = false, bottom = false, corner = 0, amp = 2.2 }: DeckleOptions = {}): string {
  const rand = mulberry32(seed)
  const pts: string[] = []
  const H = 24
  const V = 7
  // Top edge, left → right.
  for (let i = 0; i <= H; i++) {
    const x = (i / H) * 100
    const y = top ? r2(rand() * amp) : 0
    if (corner && i === H) {
      pts.push(`calc(100% - ${corner}px) ${y}px`, `100% ${corner}px`)
    } else {
      pts.push(`${r2(x)}% ${y}px`)
    }
  }
  // Right edge, top → bottom.
  for (let i = 1; i < V; i++) pts.push(`calc(100% - ${r2(rand() * amp)}px) ${r2((i / V) * 100)}%`)
  // Bottom edge, right → left.
  for (let i = H; i >= 0; i--) {
    const y = bottom ? r2(rand() * amp) : 0
    pts.push(`${r2((i / H) * 100)}% calc(100% - ${y}px)`)
  }
  // Left edge, bottom → top.
  for (let i = V - 1; i > 0; i--) pts.push(`${r2(rand() * amp)}px ${r2((i / V) * 100)}%`)
  return `polygon(${pts.join(', ')})`
}

/** Per-piece texture variation: grain offset and a faint warm/cool tint. */
export function paperVars(seed: number): CSSProperties {
  const rand = mulberry32(seed ^ 0x9e3779b9)
  const warm = rand() > 0.5
  const alpha = r2(0.02 + rand() * 0.035)
  return {
    '--gx': `${Math.floor(rand() * 7)}px`,
    '--gy': `${Math.floor(rand() * 7)}px`,
    '--tint': warm ? `rgba(150, 105, 40, ${alpha})` : `rgba(90, 100, 110, ${alpha})`,
  } as CSSProperties
}

/** A slight natural rotation in degrees, within ±max. */
export function tilt(seed: number, max = 0.5): number {
  return r2((mulberry32(seed ^ 0x51ed27)() - 0.5) * 2 * max)
}

/**
 * Story text inked onto paper: words sit a hair off the baseline with
 * slightly varying density. Whitespace stays as text, so wrapping and
 * screen readers see ordinary words.
 */
export function InkText({ text, seed }: { text: string; seed: number }) {
  const rand = mulberry32(seed)
  return (
    <span className="ink">
      {text.split(/(\s+)/).map((token, i) => {
        if (token === '' || /^\s+$/.test(token)) return token
        const style = {
          '--dy': `${r2((rand() - 0.5) * 1.3)}px`,
          '--dr': `${r2((rand() - 0.5) * 0.9)}deg`,
          '--da': r2(0.86 + rand() * 0.14),
        } as CSSProperties
        return (
          <span key={i} className="ink-word" style={style}>
            {token}
          </span>
        )
      })}
    </span>
  )
}

export type SealVariant = 'turn' | 'open' | 'progress' | 'done'

/** Wax-seal status badge. The label is rendered by the caller as text. */
export function WaxSeal({
  variant,
  icon: Icon,
  rotate = -8,
}: {
  variant: SealVariant
  icon: ComponentType<LucideProps>
  rotate?: number
}) {
  return (
    <span className={`seal seal-${variant}`} style={{ '--seal-rot': `${rotate}deg` } as CSSProperties} aria-hidden="true">
      <Icon className="size-4" strokeWidth={2.4} />
    </span>
  )
}

/** The desk surface the paper rests on. */
export function Desk({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`desk ${className}`}>{children}</div>
}

/** A steel paper clip, drawn in SVG. Decorative. */
export function PaperClip({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 64" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="clip-steel" x1="0" x2="1">
          <stop offset="0" stopColor="#8d949c" />
          <stop offset="0.5" stopColor="#e3e7eb" />
          <stop offset="1" stopColor="#7c838b" />
        </linearGradient>
      </defs>
      <path
        d="M8 20 V50 a6 6 0 0 0 12 0 V12 a8 8 0 0 0 -16 0 V52 a10 10 0 0 0 20 0"
        fill="none"
        stroke="url(#clip-steel)"
        strokeWidth="2.4"
        strokeLinecap="round"
        transform="translate(-2 4)"
      />
    </svg>
  )
}

/** A fountain pen resting on the desk, drawn in SVG. Decorative. */
export function FountainPen({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 40 240" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="pen-barrel" x1="0" x2="1">
          <stop offset="0" stopColor="#0f1720" />
          <stop offset="0.45" stopColor="#3a4a5c" />
          <stop offset="1" stopColor="#0b1118" />
        </linearGradient>
        <linearGradient id="pen-gold" x1="0" x2="1">
          <stop offset="0" stopColor="#9a7322" />
          <stop offset="0.5" stopColor="#f3d27a" />
          <stop offset="1" stopColor="#8a6418" />
        </linearGradient>
      </defs>
      {/* soft contact shadow */}
      <ellipse cx="24" cy="128" rx="9" ry="112" fill="rgba(0,0,0,0.28)" />
      {/* cap */}
      <rect x="11" y="6" width="18" height="78" rx="9" fill="url(#pen-barrel)" />
      <rect x="27" y="14" width="3" height="52" rx="1.5" fill="url(#pen-gold)" />
      <rect x="11" y="78" width="18" height="6" fill="url(#pen-gold)" />
      {/* barrel */}
      <rect x="12" y="84" width="16" height="96" rx="4" fill="url(#pen-barrel)" />
      {/* section + nib */}
      <path d="M13 180 h14 l-2 16 h-10 z" fill="#111a24" />
      <path d="M15 196 h10 l-5 34 z" fill="url(#pen-gold)" />
      <path d="M20 200 v26" stroke="#5b4313" strokeWidth="0.8" />
      <circle cx="20" cy="204" r="1.2" fill="#5b4313" />
    </svg>
  )
}
