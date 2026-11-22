/**
 * /home — signed-in users go straight to the stories lobby; signed-out
 * visitors get the folding-sheet landing with a sign-in button.
 *
 * Lives under (app)/ (not (protected)/) so it can see auth state without
 * gating the page; the app chrome (Navigation, with its own sign-in button)
 * still renders around it.
 */

import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AuthOverlay, useAuthStatus } from 'deepspace'
import { MotionConfig } from 'motion/react'
import { BookOpen, Feather, LogIn, Users } from 'lucide-react'
import { Button } from '@/components/ui'
import { Hero } from '@/components/corpse/Hero'

const STEPS = [
  { icon: Users, title: 'Gather', text: 'Start a sheet and invite a few friends to join.' },
  { icon: Feather, title: 'Write blind', text: 'Each writer sees only the line before theirs.' },
  { icon: BookOpen, title: 'Unfold', text: 'When the last line is in, everyone reads the whole thing.' },
]

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuthStatus()
  const [showAuth, setShowAuth] = useState(false)

  // Wait for the session check so signed-in users never see the landing flash.
  if (!isLoaded) return <div aria-busy="true" className="min-h-full" />
  if (isSignedIn) return <Navigate to="/stories" replace />

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-full text-foreground">
        <Hero>
          <Button size="lg" className="press gap-2" onClick={() => setShowAuth(true)}>
            <LogIn className="size-4" aria-hidden="true" />
            Sign in to play
          </Button>
        </Hero>
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
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </div>
    </MotionConfig>
  )
}
