/**
 * "How it works" — three steps, shared by the static landing (/) and the
 * signed-out /home page. Pure markup: no hooks, no data, safe to prerender.
 */

import { BookOpen, Feather, Users } from 'lucide-react'

const STEPS = [
  { icon: Users, title: 'Gather', text: 'Start a sheet and invite a few friends to join.' },
  { icon: Feather, title: 'Write blind', text: 'Each writer sees only the line before theirs.' },
  { icon: BookOpen, title: 'Unfold', text: 'When the last line is in, everyone reads the whole thing.' },
]

export function HowItWorks() {
  return (
    <section aria-label="How it works" className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="lift rounded-2xl border border-border bg-card p-5">
            <span className="font-hand text-2xl text-muted-foreground">{i + 1}.</span>
            <p className="mt-1 flex items-center gap-2 font-semibold">
              <Icon className="size-4" aria-hidden="true" />
              {title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
