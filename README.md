# Corpse Club

An online version of the parlour game Exquisite Corpse. Players take turns writing one line of a story, but each writer only ever sees the line before theirs. When the last line is written, the server reveals the whole story at once, and an AI adds a short, clearly labelled title and epilogue. Built on [DeepSpace](https://docs.deep.space).

- **Live app:** https://corpse-club.app.space
- **Showcase story:** https://corpse-club.app.space/stories/1795454866726_478v0y ("The Goat Who Ran for Mayor")

## How it works

The hidden state is enforced by the server, not the UI. Story lines live in a `lines` collection that no player role can read or write. Players can only reach them through two server actions: `getPreviousLine`, which checks the caller (from the verified JWT) holds the current turn and returns only the last line, and `submitLine`, which checks the turn, writes the line, and advances the story. A `uniqueOn ['storyId','turn']` constraint makes concurrent submits produce exactly one line. On the final turn, the full text is copied into the readable `stories` record and the story is marked revealed. Background jobs make one AI call per story at reveal (guarded by a lock) and email the next player on each turn change, with no story text in the email.

## Run it

```bash
npm install
npx deepspace auth login
npx deepspace dev start        # registers the app to your account on first run
npm run test:unit              # unit tests
npx deepspace test run all     # multi-user e2e
```

- Running your own copy needs your own app id; see `app init --new-id` in the DeepSpace CLI reference.
- The e2e suite needs two DeepSpace test accounts (see the DeepSpace testing docs). The hidden-state tests fail rather than skip if they're missing.
- Tests and the dev server both default to port 5173; run tests with `--port <other>` while dev is running.
- Local dev makes real, owner-billed AI calls and real emails to non-`@deepspace.test` addresses.

## Where things are

- `src/schemas.ts`, `src/schemas/`: collections and per-role permissions (`lines` has no client access)
- `src/actions/index.ts`: create / join / start / getPreviousLine / submitLine
- `src/lib/story-limits.ts`: strict 2–20 lines, 2–8 players validation
- `src/ai/story-ending.ts`, `story-ending-config.ts`: AI title and epilogue job, parser, safe logging
- `src/notify/turn-email.ts`, `turn-email-config.ts`: turn notification job and fixed template
- `src/jobs.ts`: job registration
- `src/pages/(app)/(protected)/stories/`: lobby and story room
- `tests/hidden-state.spec.ts`, `tests/turn-email.spec.ts`: multi-user e2e tests

## Build notes

- [AGENT_LOG.md](./AGENT_LOG.md): what I asked the coding agent, what it did, and what I verified myself
- [FRICTION_LOG.md](./FRICTION_LOG.md): onboarding and platform friction, with a top 5

## Known limits

- Locks enforce one AI call per story and one email per turn change, but there's no per-user cap (about $0.013 per email).
- No email unsubscribe.
- The `advance_failed` repair path is untested; if the reveal write itself fails, the story reveals without AI text.
- `max_tokens` (600) includes the model's thinking tokens; a very long reply would fail as `max_tokens` (logged).
- Players can see that a `lines` collection exists (schema tools), but not its contents.
- Production source maps contain test-only names as source text; they aren't in the running code.
