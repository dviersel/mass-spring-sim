import { describe, expect, it } from 'vitest'
import { barAt } from '../../src/ui/canvas/participation'

/**
 * Hit testing for the participation bars.
 *
 * Clicking a bar sets which node the traces follow, so the target has to match
 * what is drawn: the same padding and the same slot width. Getting it wrong is
 * invisible in a screenshot and only shows up as clicks landing one bar over.
 */

// Matches PAD_LEFT and PAD_RIGHT in the renderer.
const PAD_LEFT = 34
const PAD_RIGHT = 10
const WIDTH = 484 // leaves a plot area of 440, so nine bars are not a round number

describe('barAt', () => {
  it('maps the centre of each slot to its own bar', () => {
    const count = 9
    const slot = (WIDTH - PAD_LEFT - PAD_RIGHT) / count
    for (let i = 0; i < count; i++) {
      expect(barAt(PAD_LEFT + slot * (i + 0.5), WIDTH, count)).toBe(i)
    }
  })

  it('splits exactly on the boundary between neighbours', () => {
    const count = 9
    const slot = (WIDTH - PAD_LEFT - PAD_RIGHT) / count
    // Just inside each side of the first boundary.
    expect(barAt(PAD_LEFT + slot - 0.01, WIDTH, count)).toBe(0)
    expect(barAt(PAD_LEFT + slot + 0.01, WIDTH, count)).toBe(1)
  })

  it('rejects the axis gutter and the right margin', () => {
    expect(barAt(0, WIDTH, 9)).toBeNull()
    expect(barAt(PAD_LEFT - 1, WIDTH, 9)).toBeNull()
    expect(barAt(WIDTH, WIDTH, 9)).toBeNull()
    expect(barAt(WIDTH + 50, WIDTH, 9)).toBeNull()
  })

  it('covers the whole plot area with no dead columns', () => {
    const count = 8
    const seen = new Set<number>()
    for (let x = PAD_LEFT; x < WIDTH - PAD_RIGHT; x += 0.5) {
      const bar = barAt(x, WIDTH, count)
      expect(bar).not.toBeNull()
      if (bar !== null) seen.add(bar)
    }
    expect(seen.size).toBe(count)
  })

  it('handles a chain with no free nodes, and a degenerate canvas', () => {
    expect(barAt(100, WIDTH, 0)).toBeNull()
    expect(barAt(100, PAD_LEFT + PAD_RIGHT, 9)).toBeNull()
    expect(barAt(100, 10, 9)).toBeNull()
  })

  it('works down to a single bar', () => {
    expect(barAt(PAD_LEFT + 1, WIDTH, 1)).toBe(0)
    expect(barAt(WIDTH - PAD_RIGHT - 1, WIDTH, 1)).toBe(0)
  })
})
