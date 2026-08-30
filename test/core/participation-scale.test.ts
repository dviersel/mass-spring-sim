import { describe, expect, it } from 'vitest'
import { barFraction } from '../../src/ui/canvas/participation'

/**
 * Bar heights.
 *
 * The pane exists to separate a mode that is merely small from one that cannot
 * respond at all, so the scale has to keep the first visible and the second at
 * exactly nothing. On a linear scale a resonant mode buries everything else.
 */
describe('barFraction', () => {
  it('is the plain ratio on a linear scale', () => {
    expect(barFraction(0.5, 1, 'linear')).toBeCloseTo(0.5, 12)
    expect(barFraction(1, 1, 'linear')).toBeCloseTo(1, 12)
  })

  it('allows a little overshoot on linear, so a rising peak is visible', () => {
    expect(barFraction(2, 1, 'linear')).toBeCloseTo(1.15, 12)
  })

  it('gives each decade an equal share of the plot', () => {
    expect(barFraction(1, 1, 'log')).toBeCloseTo(1, 12)
    expect(barFraction(0.1, 1, 'log')).toBeCloseTo(0.75, 12)
    expect(barFraction(0.01, 1, 'log')).toBeCloseTo(0.5, 12)
    expect(barFraction(0.001, 1, 'log')).toBeCloseTo(0.25, 12)
    expect(barFraction(0.0001, 1, 'log')).toBe(0)
  })

  it('rescues the modes a linear scale buries', () => {
    // The real numbers from a sweep sitting on mode 1: mode 2 at 4.7% of the
    // peak and mode 9 at 0.2%. Linear renders both as slivers or nothing.
    expect(barFraction(0.047, 1, 'linear')).toBeLessThan(0.05)
    expect(barFraction(0.002, 1, 'linear')).toBeLessThan(0.003)

    expect(barFraction(0.047, 1, 'log')).toBeGreaterThan(0.65)
    expect(barFraction(0.002, 1, 'log')).toBeGreaterThan(0.3)
  })

  it('keeps a structurally blocked mode at exactly nothing', () => {
    // Blocked modes come out at rounding level, nine or more decades down. If
    // the log scale lifted those into view the pane would stop distinguishing
    // "cannot respond" from "small", which is the whole point.
    expect(barFraction(0, 1, 'log')).toBe(0)
    expect(barFraction(1e-9, 1, 'log')).toBe(0)
    expect(barFraction(1e-16, 1, 'log')).toBe(0)
    expect(barFraction(0, 1, 'linear')).toBe(0)
  })

  it('handles a peak of zero, before anything has been excited', () => {
    expect(barFraction(0, 0, 'log')).toBe(0)
    expect(barFraction(1, 0, 'log')).toBe(0)
    expect(barFraction(0, 0, 'linear')).toBe(0)
  })

  it('never returns a negative height or NaN', () => {
    for (const value of [-1, 0, 1e-30, 1e30, Number.NaN]) {
      for (const scale of ['linear', 'log'] as const) {
        const f = barFraction(value, 1, scale)
        expect(Number.isFinite(f)).toBe(true)
        expect(f).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
