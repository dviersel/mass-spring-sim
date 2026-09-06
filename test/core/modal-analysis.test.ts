import { describe, expect, it } from 'vitest'
import { assembleChain } from '../../src/core/assemble'
import {
  degreesOfFreedom,
  segmentStiffness,
  totalLength,
  uniformChain,
  type ChainSpec,
} from '../../src/core/chain'
import { undampedModes } from '../../src/core/eigen/jacobi'
import { Simulation } from '../../src/core/simulation'
import { setNodeForce } from '../../src/core/edit'
import { sine } from '../../src/core/signal'

/**
 * Exact natural frequencies of a uniform chain of N equal masses on identical
 * springs with both ends held still:
 *
 *   omega_n = 2 * sqrt(k/m) * sin(n*pi / (2*(N+1))),  n = 1..N
 *
 * where k is the stiffness of a single SEGMENT.
 */
function analyticalOmega(n: number, count: number, k: number, m: number): number {
  return 2 * Math.sqrt(k / m) * Math.sin((n * Math.PI) / (2 * (count + 1)))
}

const MASS = 0.05 // kg
const LENGTH = 1.0 // m
const NODE_COUNT = 11 // nine free masses plus two ends: ten segments
// Chosen so the segment stiffness is exactly 1000 N/m and the highest mode
// lands around 44 Hz, in the tens-of-hertz range the real system lives in.
const TOTAL_STIFFNESS = 100 // N/m end to end

function chain(drivenNodes: readonly number[]): ChainSpec {
  return uniformChain({
    nodeCount: NODE_COUNT,
    length: LENGTH,
    totalStiffness: TOTAL_STIFFNESS,
    totalDamping: 0,
    mass: MASS,
    drivenNodes,
  })
}

/** Largest relative error between two ascending frequency lists. */
function worstRelativeError(actual: Float64Array, expected: readonly number[]): number {
  expect(actual.length).toBe(expected.length)
  let worst = 0
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i] as number
    const got = actual[i] as number
    worst = Math.max(worst, Math.abs(got - want) / want)
  }
  return worst
}

describe('segment stiffness scaling', () => {
  it('splits one continuous spring, not ten independent ones', () => {
    const spec = chain([0, 10])
    // k_segment = k_total * L_total / L_segment, so ten equal segments are each
    // ten times as stiff as the whole spring.
    expect(segmentStiffness(spec, 0)).toBeCloseTo(1000, 10)
    expect(totalLength(spec)).toBeCloseTo(LENGTH, 12)

    // Springs in series must reproduce the total: sum(1/k_i) = 1/k_total.
    let compliance = 0
    for (let i = 0; i < NODE_COUNT - 1; i++) compliance += 1 / segmentStiffness(spec, i)
    expect(1 / compliance).toBeCloseTo(TOTAL_STIFFNESS, 10)
  })
})

describe('definition of done 1: uniform chain, both ends driven', () => {
  const spec = chain([0, 10])
  const matrices = assembleChain(spec)
  const modes = undampedModes(matrices.Mff, matrices.Kff)
  const k = segmentStiffness(spec, 0)

  it('has nine degrees of freedom, derived rather than assumed', () => {
    expect(degreesOfFreedom(spec)).toBe(9)
    expect(matrices.dof).toBe(9)
    expect(matrices.freeIndices).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(matrices.drivenIndices).toEqual([0, 10])
  })

  it('assembles a symmetric stiffness matrix', () => {
    expect(matrices.Kff.asymmetry()).toBe(0)
    expect(matrices.Cff.asymmetry()).toBe(0)
  })

  it('matches the analytical dispersion relation to near machine precision', () => {
    const expected = Array.from({ length: 9 }, (_, i) => analyticalOmega(i + 1, 9, k, MASS))
    const worst = worstRelativeError(modes.omega, expected)
    expect(modes.converged).toBe(true)
    expect(worst).toBeLessThan(1e-14)
  })

  it('produces mass-normalised mode shapes', () => {
    for (let r = 0; r < matrices.dof; r++) {
      let norm = 0
      for (let i = 0; i < matrices.dof; i++) {
        const phi = modes.shapes.get(i, r)
        norm += MASS * phi * phi
      }
      expect(norm).toBeCloseTo(1, 12)
    }
  })
})

describe('definition of done 2: interior node 5 driven, chain decouples', () => {
  const spec = chain([0, 5, 10])
  const matrices = assembleChain(spec)
  const modes = undampedModes(matrices.Mff, matrices.Kff)
  const k = segmentStiffness(spec, 0)

  it('drops to eight degrees of freedom, skipping the driven interior node', () => {
    expect(matrices.dof).toBe(8)
    expect(matrices.freeIndices).toEqual([1, 2, 3, 4, 6, 7, 8, 9])
    expect(matrices.drivenIndices).toEqual([0, 5, 10])
  })

  it('leaves the two sub-chains unable to feel each other', () => {
    // Free nodes 1..4 occupy degrees of freedom 0..3, free nodes 6..9 occupy
    // 4..7. Every cross term between those blocks must be exactly zero.
    for (let a = 0; a < 4; a++) {
      for (let b = 4; b < 8; b++) {
        expect(matrices.Kff.get(a, b)).toBe(0)
        expect(matrices.Kff.get(b, a)).toBe(0)
      }
    }
  })

  it('still couples both sub-chains to the driven interior node', () => {
    // Node 5 is driven slot 1. If this column were empty the decoupling above
    // would be vacuous -- the sub-chains would be ignoring node 5 entirely
    // rather than each being driven by it.
    const slotOfNodeFive = 1
    expect(matrices.Kfd.get(3, slotOfNodeFive)).toBeCloseTo(-k, 10) // free node 4
    expect(matrices.Kfd.get(4, slotOfNodeFive)).toBeCloseTo(-k, 10) // free node 6
  })

  it('matches the N=4 dispersion relation with every frequency appearing twice', () => {
    const expected: number[] = []
    for (let n = 1; n <= 4; n++) {
      const omega = analyticalOmega(n, 4, k, MASS)
      expected.push(omega, omega)
    }
    expected.sort((a, b) => a - b)

    const worst = worstRelativeError(modes.omega, expected)
    expect(modes.converged).toBe(true)
    expect(worst).toBeLessThan(1e-14)
  })

  it('produces exactly four distinct frequencies, each with multiplicity two', () => {
    const distinct: number[] = []
    for (const omega of modes.omega) {
      const seen = distinct.find((d) => Math.abs(d - omega) / omega < 1e-10)
      if (seen === undefined) distinct.push(omega)
    }
    expect(distinct).toHaveLength(4)

    for (const d of distinct) {
      const multiplicity = Array.from(modes.omega).filter(
        (omega) => Math.abs(d - omega) / omega < 1e-10,
      ).length
      expect(multiplicity).toBe(2)
    }
  })
})

describe('modal coordinates', () => {
  it('reconstructs the motion exactly when summed over modes', () => {
    // The property the decomposed trace draws: every mode's contribution to a
    // node, added up, IS that node's displacement. If this drifts, the picture
    // stops being a decomposition and becomes a coincidence.
    const spec = uniformChain({
      nodeCount: 9,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0.09,
      mass: 0.05,
      drivenNodes: [0, 8],
    })
    const sim = new Simulation(setNodeForce(spec, 3, sine(0.02, 23)))
    const matrices = sim.chainMatrices
    const shapes = sim.modeShapes

    for (let step = 0; step < 200; step++) {
      sim.step(sim.timestep)
      if (step % 40 !== 0) continue

      const q = sim.modalCoordinates()
      const displacement = sim.nodeDisplacements()
      for (let a = 0; a < sim.dof; a++) {
        let sum = 0
        for (let r = 0; r < sim.dof; r++) sum += shapes.get(a, r) * (q[r] as number)
        const node = matrices.freeIndices[a] as number
        expect(sum).toBeCloseTo(displacement[node] as number, 12)
      }
    }
  })

  it('is signed, where the amplitude envelope is not', () => {
    const spec = uniformChain({
      nodeCount: 7,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0,
      mass: 0.05,
      drivenNodes: [0, 6],
    })
    const sim = new Simulation(spec)
    sim.setStateFromMode(0, 0.002)

    const seen = new Set<number>()
    for (let step = 0; step < 600; step++) {
      sim.step(sim.timestep)
      seen.add(Math.sign(sim.modalCoordinates()[0] as number))
      // The envelope never goes negative, whatever the coordinate does.
      expect(sim.modalAmplitudes()[0] as number).toBeGreaterThanOrEqual(0)
    }
    expect(seen.has(1) && seen.has(-1)).toBe(true)
  })
})

describe('summing every node', () => {
  it('cancels the antisymmetric modes exactly', () => {
    // What the summed trace claims on screen. A symmetric chain has mode shapes
    // that alternate symmetric and antisymmetric about the centre; the
    // antisymmetric ones sum to zero over the nodes, so adding every trace
    // together is a filter that removes them and leaves a simpler composite.
    const spec = uniformChain({
      nodeCount: 11,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0,
      mass: 0.05,
      drivenNodes: [0, 10],
    })
    const sim = new Simulation(spec)
    const shapes = sim.modeShapes

    for (let r = 0; r < sim.dof; r++) {
      let total = 0
      let magnitude = 0
      for (let a = 0; a < sim.dof; a++) {
        total += shapes.get(a, r)
        magnitude += Math.abs(shapes.get(a, r))
      }
      // Modes 2, 4, 6, 8 are the antisymmetric ones and vanish from the sum, at
      // 1e-16 and below. The symmetric ones run from 1.0 down to 0.025 -- the
      // highest alternates most and so sums to the least -- which is still
      // thirteen orders of magnitude clear of cancelling. That separation, not
      // either magnitude on its own, is what this test is about.
      if ((r + 1) % 2 === 0) expect(Math.abs(total) / magnitude).toBeLessThan(1e-12)
      else expect(Math.abs(total) / magnitude).toBeGreaterThan(1e-2)
    }
  })

  it('leaves a summed trace with no trace of an antisymmetric mode', () => {
    const spec = uniformChain({
      nodeCount: 11,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0,
      mass: 0.05,
      drivenNodes: [0, 10],
    })
    // Released purely into mode 2, every node moves and yet their sum does not.
    const sim = new Simulation(spec)
    sim.setStateFromMode(1, 0.003)

    let peakNode = 0
    let peakSum = 0
    for (let step = 0; step < 400; step++) {
      sim.step(sim.timestep)
      const displacement = sim.nodeDisplacements()
      let total = 0
      for (let i = 0; i < displacement.length; i++) {
        total += displacement[i] as number
        peakNode = Math.max(peakNode, Math.abs(displacement[i] as number))
      }
      peakSum = Math.max(peakSum, Math.abs(total))
    }
    expect(peakNode).toBeGreaterThan(1e-3)
    expect(peakSum).toBeLessThan(peakNode * 1e-9)
  })
})
