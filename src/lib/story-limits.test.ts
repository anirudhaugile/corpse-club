import { describe, expect, it } from 'vitest'
import { MAX_LINES, MAX_PLAYERS, MIN_LINES, MIN_PLAYERS, isIntInRange } from './story-limits'

describe('story limits', () => {
  it('lines are 2..20 and players 2..8', () => {
    expect([MIN_LINES, MAX_LINES]).toEqual([2, 20])
    expect([MIN_PLAYERS, MAX_PLAYERS]).toEqual([2, 8])
  })
})

describe('isIntInRange (lines: 2..20)', () => {
  const lines = (v: unknown) => isIntInRange(v, MIN_LINES, MAX_LINES)

  it('accepts integers 2..20 inclusive', () => {
    for (let n = 2; n <= 20; n++) expect(lines(n), String(n)).toBe(true)
  })

  it('rejects out-of-range integers', () => {
    for (const v of [21, 1, 0, -5, 40, 1000, -0.0 - 1]) expect(lines(v), String(v)).toBe(false)
  })

  it('rejects non-integers and non-finite numbers', () => {
    for (const v of [2.5, 19.999, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(lines(v), String(v)).toBe(false)
    }
  })

  it('rejects every non-number, including numeric strings (no coercion)', () => {
    for (const v of ['20', ' 3 ', '0x3', '', true, false, null, undefined, [20], { n: 20 }, 20n]) {
      expect(lines(v), JSON.stringify(String(v))).toBe(false)
    }
  })

  it('applies the same rule to the player cap (2..8)', () => {
    expect(isIntInRange(2, MIN_PLAYERS, MAX_PLAYERS)).toBe(true)
    expect(isIntInRange(8, MIN_PLAYERS, MAX_PLAYERS)).toBe(true)
    for (const v of [1, 9, 3.5, '3']) expect(isIntInRange(v, MIN_PLAYERS, MAX_PLAYERS), String(v)).toBe(false)
  })
})
