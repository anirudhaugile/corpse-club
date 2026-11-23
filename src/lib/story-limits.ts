/**
 * Story size limits — shared by the server (src/actions/index.ts createStory,
 * the authority) and the create form (input min/max and hint only).
 * Pure: no imports, safe in the worker, the browser and Node tests.
 */

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 8
export const MIN_LINES = 2
export const MAX_LINES = 20

/**
 * True only for a real JSON number that is an integer in [min, max].
 * No coercion: "20", " 3 ", "0x3", true, null and 2.5 are all rejected.
 */
export function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}
