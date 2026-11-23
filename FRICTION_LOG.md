# Friction log

Where onboarding, docs, CLI, or SDK behavior surprised me while building Corpse Club. Format: what I did / expected / happened / suggested fix. Source labels: [seen by me] = observed directly; [agent-read] = reported by Claude Code from code or docs, not reproduced by me.

## Top 5
1. GitHub-source deploys record no commit (item 16): a log line from new code was my only proof of what was live.
2. Email From address: docs say <app-name>@app.space; mail actually comes from notifications@updates.app.space (item 17).
3. Any member can enqueue any job type from the client socket (item 12): every job handler must re-check its own preconditions.
4. The agent skill isn't loaded by Claude Code (item 5): installs to .agents/skills, and CLAUDE.md links AGENTS.md instead of importing it.
5. Schema lint bundles schemas.ts with plain esbuild (item 13): build constants used by the app break it.

## All items
1. Scaffold into current directory [seen by me]
   - Did: `npm create deepspace@latest .` in a folder whose name wasn't a valid app name.
   - Expected: success, or the rule documented. Happened: clear error; I didn't find the rule on the installation page.
   - Fix: document the naming rule, or prompt for an app name.

2. Scaffold didn't install the agent skill [seen by me]
   - Happened: no .agents/ or skills-lock.json; .deepspace/ held only "install.started".
   - Fix: surface a failed skill install as a visible warning with the manual command.

3. Mixed package-manager signals [seen by me]
   - Happened: no lockfile generated; .yarnrc.yml and pnpm-workspace.yaml present although docs use npm.
   - Fix: generate a lockfile for the documented package manager.

4. Skill references are a placeholder [seen by me]
   - Happened: references/README.md is 5 lines; RBAC, actions, and testing patterns exist only in scaffold code and docs.
   - Fix: point references at the concept pages, or ship the docs MCP config.

5. Skill isn't loaded by Claude Code [agent-read; symlink fix seen by me]
   - Happened: Claude Code reads .claude/skills/, not .agents/skills/; CLAUDE.md's plain link loads nothing.
   - Fix: scaffold CLAUDE.md with `@AGENTS.md` and add .claude/skills/deepspace.

6. Global skill install [seen by me]
   - Happened: the installer also installed find-skills globally (~/.agents/skills); I removed it afterwards.
   - Fix: don't install extra skills globally by default.

7. Irreversible source-control switch without confirmation [seen by me]
   - Did: pushed to GitHub (the brief requires a repo link), then deployed.
   - Happened: the deploy output stated GitHub is now permanently the app's source and DeepSpace push/pull/clone/workspace verbs refuse; the message appeared during the deploy with no confirmation prompt before it.
   - Fix: confirm before an irreversible switch; document the tradeoff.

8. No documented way to set or assert a role in tests [agent-read]
   - Fix: a role helper in deepspace/testing, or docs on test-account roles.

9. Explicit record id merges: easy to miss [agent-read]
   - Happened: creating with an existing id merges into the record (consistent with put's documented merge semantics, but easy to miss when you want a uniqueness lock). Used uniqueOn instead.
   - Fix: a note on the records page pointing to uniqueOn for create-only semantics.

10. ownerField: docs vs code [agent-read, not verified by me]
   - Happened: docs say _created_by; code uses record.createdBy.
   - Fix: align them.

11. No conditional update in the record room [agent-read]
   - Happened: no compare-and-set; worked around with a server-only claim collection plus uniqueOn.
   - Fix: add a conditional update, or document the uniqueOn-claim pattern.

12. Members can enqueue any job type from the client socket [agent-read: AppJobRoom.authorizeWrite]
   - Happened: every handler must re-check preconditions; spam enqueues still use job capacity.
   - Fix: server-only enqueue by default, opt-in per job type.

13. Schema lint bundles schemas.ts with plain esbuild [agent-found; fix seen by me]
   - Happened: lint failed on a build constant the app's Vite config defines; fixed with a typeof guard.
   - Fix: run schema lint with the app's defines, or document the constraint.

14. Tests and dev server aren't isolated [seen by me]
   - Happened: both default to port 5173 ("Port 5173 is already in use"), and both use .wrangler/state, so test runs add stories to my dev lobby.
   - Fix: give the test runner its own port and state directory by default.

15. Production logs lag [seen by me]
   - Happened: first search empty; found about a minute later.
   - Fix: mention the lag up front, or add a --wait option.

16. GitHub-source deploys record no commit [seen by me]
   - Happened: no commit lineage in deploy output or releases; I used a log line from new code as proof of what was live.
   - Fix: record the git SHA on each release.

17. Email From address: docs vs reality [seen by me]
   - Expected (docs): <app-name>@app.space. Happened: "DeepSpace Apps <notifications@updates.app.space>", matching the CLI catalog ("any from value is ignored").
   - Fix: update the docs.

18. Shared-sender deliverability [seen by me]
   - Happened: the email landed in Junk on UW-Madison mail; apps can't set sender or domain.
   - Fix: custom sender domains, or document expected deliverability.

19. AI replies with thinking blocks [seen by me in production logs; shape agent-read]
   - Happened: Haiku sometimes returns thinking blocks (128–178 thinking tokens) with no way to disable thinking via the integration's inputs [agent-read]; thinking counts toward max_tokens.
   - Fix: document the response shape with thinking in the integration catalog, and offer a thinking toggle.
