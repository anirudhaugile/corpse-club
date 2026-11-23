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
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui'
import { Hero } from '@/components/corpse/Hero'
import { HowItWorks } from '@/components/corpse/HowItWorks'

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
        <HowItWorks />
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </div>
    </MotionConfig>
  )
}
