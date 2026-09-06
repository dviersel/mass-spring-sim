import { describe, expect, it } from 'vitest'
import { assembleChain, rebuildStiffnessInPlace } from '../../src/core/assemble'
import {
  hasGroundStiffness,
  nodeGroundDamping,
  segmentStiffness,
  uniformChain,
  validateChain,
  type ChainSpec,
} from '../../src/core/chain'
import { setNodeGroundDamping, setNodeMotion, tetherAll } from '../../src/core/edit'
import { analyseModes } from '../../src/core/eigen/modal'
import { Simulation } from '../../src/core/simulation'
import { sine } from '../../src/core/signal'

/**
 * On-site terms: springs and dashpots tying a node to ground rather than to a
 * neighbour.
 *
 * These are the first elements in the system that are not between two nodes, so
 * the tests here are mostly about where they land -- on the diagonal, in Kff and
 * Cff, and never in the coupling blocks that carry prescribed motion.
 */

const MASS = 0.05
const chain = (nodeCount = 11, drivenNodes = [0, nodeCount - 1]): ChainSpec =>
  uniformChain({
    nodeCount,
    length: 1,
    totalStiffness: 100,
    totalDamping: 0,
    mass: MASS,
    drivenNodes,
  })

describe('tether to ground: stiffness', () => {
  it('shifts the whole spectrum by the cutoff, exactly', () => {
    // The analytical result this addition exists for. A plain chain carries
    // arbitrarily slow waves; an on-site spring gives every mode a floor:
    //
    //   omega_n^2 = k_g/m + (4k/m) sin^2(n.pi / 2(N+1))
    //
    // which is the untethered dispersion relation lifted bodily by k_g/m.
    const kg = 4000
    const spec = tetherAll(chain(11), kg)
    const sim = new Simulation(spec)

    const n = 9
    const k = segmentStiffness(spec, 0)
    for (let i = 0; i < n; i++) {
      const q = ((i + 1) * Math.PI) / (2 * (n + 1))
      const expected = Math.sqrt(kg / MASS + ((4 * k) / MASS) * Math.sin(q) ** 2)
      expect(sim.naturalFrequencies[i] as number).toBeCloseTo(expected, 6)
    }
  })

  it('puts a floor under the lowest mode — the cutoff frequency', () => {
    const kg = 4000
    const cutoff = Math.sqrt(kg / MASS)
    const bare = new Simulation(chain(11))
    const tethered = new Simulation(tetherAll(chain(11), kg))

    // Nothing below the cutoff, where the bare chain has a mode far below it.
    expect(tethered.naturalFrequencies[0] as number).toBeGreaterThan(cutoff)
    expect(bare.naturalFrequencies[0] as number).toBeLessThan(cutoff)
  })

  it('stamps on the diagonal only, never into the coupling blocks', () => {
    // A tether couples a node to ground, not to a prescribed neighbour, so it
    // must not change how driven motion reaches the free equations.
    const bare = assembleChain(chain(6))
    const tethered = assembleChain(tetherAll(chain(6), 2500))

    for (let a = 0; a < bare.dof; a++) {
      for (let b = 0; b < bare.drivenIndices.length; b++) {
        expect(tethered.Kfd.get(a, b)).toBe(bare.Kfd.get(a, b))
        expect(tethered.Cfd.get(a, b)).toBe(bare.Cfd.get(a, b))
      }
      for (let b = 0; b < bare.dof; b++) {
        const delta = tethered.Kff.get(a, b) - bare.Kff.get(a, b)
        expect(delta).toBeCloseTo(a === b ? 2500 : 0, 9)
      }
    }
  })

  it('survives a rebuild in the time-varying regime', () => {
    // Kff is zeroed and restamped from the segments at every RK4 stage. A tether
    // is not modulated, but it still has to come back, or a tethered chain would
    // lose its cutoff the moment any segment started modulating.
    const spec = tetherAll(chain(6), 2500)
    const matrices = assembleChain(spec)
    const reference = assembleChain(spec)

    rebuildStiffnessInPlace(spec, matrices, undefined)
    for (let a = 0; a < matrices.dof; a++) {
      for (let b = 0; b < matrices.dof; b++) {
        expect(matrices.Kff.get(a, b)).toBeCloseTo(reference.Kff.get(a, b), 9)
      }
    }
  })

  it('lets a slack string have transverse modes, which validation used to deny', () => {
    const slack: ChainSpec = { ...chain(6), motionMode: 'transverse', tension: 0 }
    expect(validateChain(slack).length).toBeGreaterThan(0)

    const tethered = tetherAll(slack, 2500)
    expect(hasGroundStiffness(tethered)).toBe(true)
    expect(validateChain(tethered)).toEqual([])
    expect(new Simulation(tethered).naturalFrequencies[0]).toBeGreaterThan(0)
  })

  it('rejects a negative tether', () => {
    expect(validateChain(tetherAll(chain(6), -1)).join(' ')).toContain('must not be negative')
  })
})

describe('tether to ground: damping', () => {
  it('is the one damping that does not share the stiffness connectivity', () => {
    // Segment dashpots stamp with K's exact pattern, which keeps the system
    // classically damped. A dashpot to ground cannot: it resists absolute
    // velocity, so C stops being a scalar multiple of K in the modal basis.
    const withSegmentDamping: ChainSpec = { ...chain(8), totalDamping: 0.09 }
    const bare = assembleChain(withSegmentDamping)
    expect(analyseModes(bare.Mff, bare.Cff, bare.Kff).classicallyDamped).toBe(true)

    const terminated = setNodeGroundDamping(withSegmentDamping, 4, 0.4)
    const m = assembleChain(terminated)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)

    expect(analysis.classicallyDamped).toBe(false)
    expect(analysis.nonProportionality).toBeGreaterThan(1e-3)
    // Every damping ratio still comes back finite and sub-critical here, which
    // is the state-space solver doing the work the projection could not.
    for (const mode of analysis.modes) {
      expect(Number.isFinite(mode.zeta)).toBe(true)
      expect(mode.zeta).toBeGreaterThan(0)
    }
  })

  it('absorbs at the far end instead of reflecting', () => {
    // Drive one end at a resonance of the reflecting chain. Reflection is what
    // builds a standing wave, so a matched termination -- c = sqrt(k.m), the
    // chain's characteristic impedance at long wavelength -- should leave the
    // response far smaller than the same chain with an open end.
    const base = setNodeMotion(chain(11, [0]), 0, sine(4e-4, 0))
    const k = segmentStiffness(base, 0)

    const at = (spec: ChainSpec, hz: number): number => {
      const driven = setNodeMotion(spec, 0, sine(4e-4, hz))
      const sim = new Simulation(driven)
      let peak = 0
      for (let step = 0; step < 4000; step++) {
        sim.advance(sim.timestep)
        peak = Math.max(peak, sim.energy())
      }
      return peak
    }

    const open = new Simulation(base)
    const resonance = open.modalAnalysis.modes[0]?.frequencyHz ?? 1
    const matched = setNodeGroundDamping(base, 10, Math.sqrt(k * MASS))

    expect(nodeGroundDamping(matched, 10)).toBeCloseTo(Math.sqrt(k * MASS), 12)
    expect(at(matched, resonance)).toBeLessThan(at(base, resonance) / 5)
  })
})
