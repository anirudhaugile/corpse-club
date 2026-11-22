/**
 * Build-time constants injected by vite.config.ts `define` (and
 * vitest.config.ts for unit tests).
 *
 * __CORPSE_TEST_HOOKS__ is true only for `vite serve` started by the
 * Playwright test runner with the test-only stub token in its environment.
 * Every `vite build` (and so every `deepspace deploy`) compiles it to
 * `false`, and the bundler removes the code it guards.
 */
declare const __CORPSE_TEST_HOOKS__: boolean
