/**
 * "It's your turn" email — fixed template and constants. No imports, so the
 * Playwright spec (Node) can load it.
 *
 * The email carries NO user-controlled text: no story title, no player
 * names, no lines. Email is outside the app's access control (hidden state
 * must not travel through it) and user text in an email is a phishing /
 * spoofing vector. Only the fixed subject, fixed body and a link.
 */

/** Job type handled by src/jobs.ts; enqueued by startStory / submitLine. */
export const TURN_EMAIL_JOB = 'turn-email'

/**
 * Base URL for links. A constant — never the request Host header or anything
 * from the client.
 */
export const PUBLIC_APP_ORIGIN = 'https://corpse-club.app.space'

/** The catalog says email/send ignores `from` (sends as DeepSpace Apps); the docs say <app>@app.space. */
export const TURN_EMAIL_FROM = 'Corpse Club <corpse-club@app.space>'
export const TURN_EMAIL_SUBJECT = "It's your turn in Corpse Club"

/** Server-generated story ids look like `1795387078406_gnec4k`. */
export const STORY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface TurnEmailBody {
  from: string
  to: string
  subject: string
  text: string
}

/** The complete email. `storyId` must match STORY_ID_RE (checked by the caller). */
export function buildTurnEmail(to: string, storyId: string): TurnEmailBody {
  if (!STORY_ID_RE.test(storyId)) throw new Error('invalid story id')
  return {
    from: TURN_EMAIL_FROM,
    to,
    subject: TURN_EMAIL_SUBJECT,
    text: `It's your turn in Corpse Club.\n\n${PUBLIC_APP_ORIGIN}/stories/${encodeURIComponent(storyId)}\n`,
  }
}
