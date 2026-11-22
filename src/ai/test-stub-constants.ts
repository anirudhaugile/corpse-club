/**
 * TEST-ONLY constants shared by src/ai/test-stub.ts (worker, test builds only)
 * and tests/ai-ending.spec.ts (Playwright, Node). Kept free of the JSON
 * fixture import so the Node test runner can load it.
 */

/** Story text markers that steer the stub. */
export const STUB_FAIL = 'STUB_FAIL'
export const STUB_LONG_TITLE = 'STUB_LONG_TITLE'
export const STUB_TRUNCATED = 'STUB_TRUNCATED'

/** Contains markup on purpose: the UI must render it as literal text. */
export const STUB_TITLE = 'A <b>Stubbed</b> Title'
export const STUB_ENDING = 'The stub closed the story with <i>tags</i> intact. Nothing more happened.'
