import { describe, expect, it } from 'vitest'
import { assembleChain } from '../../src/core/assemble'
import { uniformChain, type ChainSpec } from '../../src/core/chain'
import { analyseModes } from '../../src/core/eigen/modal'

/**
 * Which excitation mechanisms couple into which modes.
 *
 * These are exact symmetry results on a uniform chain with both ends held, and
 * the interactive presets make these claims to the user, so they are pinned
 * here rather than taken on trust. Mode numbering is 1-based to match the
 * physics convention and the on-screen table.
 */

const MASS = 0.05
const NODE_COUNT = 11

function uniform(): ChainSpec {
  return uniformChain({
    nodeCount: NODE_COUNT,
    length: 1,
    totalStiffness: 100,
    totalDamping: 0.5,
    mass: MASS,
    drivenNodes: [0, 10],
  })
}

const spec = uniform()
const matrices = assembleChain(spec)
const { shapes } = analyseModes(matrices.Mff, matrices.Cff, matrices.Kff)

/** Generalised force on each mode from a unit external force at a free node. */
function forceCoupling(nodeIndex: number): number[] {
  const dofIndex = matrices.dofOfNode[nodeIndex] as number
  expect(dofIndex).toBeGreaterThanOrEqual(0)
  return matrices.freeIndices.map((_, r) => shapes.get(dofIndex, r))
}

/**
 * Generalised force on each mode from a unit actuator stroke in a segment.
 *
 * The actuator pushes its two end nodes apart, so what a mode feels is its own
 * extension across that segment. A driven end node contributes nothing.
 */
function actuatorCoupling(segmentIndex: number): number[] {
  const lower = matrices.dofOfNode[segmentIndex] as number
  const upper = matrices.dofOfNode[segmentIndex + 1] as number
  return matrices.freeIndices.map((_, r) => {
    const atUpper = upper >= 0 ? shapes.get(upper, r) : 0
    const atLower = lower >= 0 ? shapes.get(lower, r) : 0
    return atUpper - atLower
  })
}

/** Coupling from prescribed motion of a driven node, through the Kfd block. */
function motionCoupling(nodeIndex: number): number[] {
  const slot = matrices.slotOfNode[nodeIndex] as number
  expect(slot).toBeGreaterThanOrEqual(0)
  return matrices.freeIndices.map((_, r) => {
    let sum = 0
    for (let a = 0; a < matrices.dof; a++) sum += shapes.get(a, r) * matrices.Kfd.get(a, slot)
    return sum
  })
}

function relativeTo(coupling: readonly number[]): (mode: number) => number {
  const peak = Math.max(...coupling.map(Math.abs))
  return (mode: number) => Math.abs(coupling[mode - 1] as number) / peak
}

describe('a force at the centre node cannot excite the even modes', () => {
  // Mode r has shape sin(r.pi.j/10), so at the centre node j=5 it is
  // sin(r.pi/2): exactly zero for every even r. The centre is a stationary
  // point of those modes, so pushing there does no work on them.
  const relative = relativeTo(forceCoupling(5))

  it.each([2, 4, 6, 8])('leaves mode %i dark', (mode) => {
    expect(relative(mode)).toBeLessThan(1e-12)
  })

  it.each([1, 3, 5, 7, 9])('drives mode %i strongly', (mode) => {
    expect(relative(mode)).toBeGreaterThan(0.3)
  })
})

describe('an actuator in segment 2 cannot excite modes 2 or 6', () => {
  // A mode feels an actuator only through its extension across that segment.
  // Mode r's extension across the segment joining nodes i and i+1 is
  // proportional to cos(r.pi.(2i+1)/20), which vanishes when r.(2i+1) is an odd
  // multiple of 10. For i=2 that is r=2 and r=6.
  const relative = relativeTo(actuatorCoupling(2))

  it.each([2, 6])('leaves mode %i dark', (mode) => {
    expect(relative(mode)).toBeLessThan(1e-12)
  })

  it.each([1, 3, 4, 5, 7, 8, 9])('still reaches mode %i', (mode) => {
    expect(relative(mode)).toBeGreaterThan(0.1)
  })
})

describe('shaking an end node reaches every mode', () => {
  // Prescribed motion at node 0 couples through phi_r at node 1, which is
  // sin(r.pi/10) -- never zero for r = 1..9. So an end shaker has no blind
  // spot, which is the contrast that makes the two results above interesting.
  const relative = relativeTo(motionCoupling(0))

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('reaches mode %i', (mode) => {
    expect(relative(mode)).toBeGreaterThan(0.05)
  })
})
