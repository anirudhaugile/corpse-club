/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 *
 * Corpse Club: the same paper hero and three steps as the signed-out /home
 * page, with the hero in its CSS-only mode (`animated={false}`). Nothing here
 * imports `deepspace`; the button is a plain link into the app.
 */

import { Link } from 'react-router-dom'
import { Feather } from 'lucide-react'
import { Seo } from '../components/Seo'
import { Hero } from '../components/corpse/Hero'
import { HowItWorks } from '../components/corpse/HowItWorks'
import { buttonVariants } from '../components/ui'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="relative flex min-h-screen flex-col text-foreground">
        {/* Overlaid on the hero so its ambient background runs to the top edge. */}
        <header className="absolute inset-x-0 top-0 z-10 mx-auto flex w-full max-w-5xl items-center px-4 pt-6 sm:px-6">
          <span className="font-hand text-2xl">{APP_NAME}</span>
        </header>
        <main className="flex-1">
          {/* Small screens: room under the overlaid wordmark. */}
          <Hero animated={false} className="pt-10 md:pt-0">
            <Link to="/home" className={buttonVariants({ size: 'lg', className: 'press gap-2' })}>
              <Feather className="size-4" aria-hidden="true" />
              Start writing
            </Link>
          </Hero>
          <HowItWorks />
        </main>
      </div>
    </>
  )
}
