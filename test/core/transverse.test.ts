import { describe, expect, it } from 'vitest'
import { assembleChain } from '../../src/core/assemble'
import {
  actuatorsApply,
  segmentDamping,
  segmentStiffness,
  uniformChain,
  validateChain,
  type ChainSpec,
} from '../../src/core/chain'
import { analyseModes } from '../../src/core/eigen/modal'
import { setMotionMode, setNodeForce, setSegmentActuator } from '../../src/core/edit'
import { PRESETS, initialChain } from '../../src/ui/presets'
import { Simulation } from '../../src/core/simulation'
import { sine, step } from '../../src/core/signal'

/**
 * The transverse regime: masses moving perpendicular to the spring, restored by
 * tension rather than by the spring's own stiffness.
 *
 * A taut string of N equal masses under tension T, with segment length L and
 * both ends held, has segment stiffness T/L and therefore the same dispersion
 * relation with k replaced by T/L:
 *
 *   omega_n = 2 * sqrt(T / (m.L)) * sin(n.pi / (2(N+1)))
 */

const MASS = 0.05
const LENGTH = 1
const TENSION = 120 // N
const NODE_COUNT = 11

function transverseChain(overrides: Partial<ChainSpec> = {}): ChainSpec {
  return {
    ...uniformChain({
      nodeCount: NODE_COUNT,
      length: LENGTH,
      totalStiffness: 100,
      totalDamping: 0.09,
      mass: MASS,
      drivenNodes: [0, NODE_COUNT - 1],
      motionMode: 'transverse',
      tension: TENSION,
    }),
    ...overrides,
  }
}

describe('transverse segment stiffness comes from tension', () => {
  const spec = transverseChain()

  it('is T over segment length, not the spring stiffness', () => {
    const segmentLength = LENGTH / (NODE_COUNT - 1)
    expect(segmentStiffness(spec, 0)).toBeCloseTo(TENSION / segmentLength, 10)
  })

  it('ignores the spring stiffness entirely', () => {
    // Changing k_total must not move a transverse frequency by even a rounding
    // step: transverse restoring force is tension alone.
    const stiffer = { ...spec, totalStiffness: 100000 }
    const a = assembleChain(spec)
    const b = assembleChain(stiffer)
    expect(b.Kff.toRows()).toEqual(a.Kff.toRows())
  })

  it('still scales inversely with segment length, so uneven spacing works', () => {
    const uneven: ChainSpec = {
      ...spec,
      nodes: spec.nodes.map((n, i) => ({ ...n, position: i === 1 ? 0.02 : n.position })),
    }
    // Segment 0 is now 0.02 m against segment 2's 0.1 m, so it is five times stiffer.
    expect(segmentStiffness(uneven, 0) / segmentStiffness(uneven, 2)).toBeCloseTo(5, 10)
  })

  it('refuses a slack string, which has no transverse modes at all', () => {
    const slack = { ...spec, tension: 0 }
    expect(validateChain(slack).join(' ')).toMatch(/tension/)
    expect(validateChain(spec)).toEqual([])
  })
})

describe('transverse dispersion relation', () => {
  it('matches the analytical result to near machine precision', () => {
    const spec = transverseChain()
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    const segmentLength = LENGTH / (NODE_COUNT - 1)
    const base = 2 * Math.sqrt(TENSION / (MASS * segmentLength))

    expect(analysis.modes).toHaveLength(9)
    let worst = 0
    for (let n = 1; n <= 9; n++) {
      const expected = base * Math.sin((n * Math.PI) / (2 * 10))
      const actual = analysis.modes[n - 1]?.omega ?? 0
      worst = Math.max(worst, Math.abs(actual - expected) / expected)
    }
    expect(worst).toBeLessThan(1e-14)
  })

  it('holds at every chain size', () => {
    for (const nodeCount of [3, 6, 12, 17]) {
      const spec = transverseChain({
        ...uniformChain({
          nodeCount,
          length: LENGTH,
          totalStiffness: 100,
          totalDamping: 0.09,
          mass: MASS,
          drivenNodes: [0, nodeCount - 1],
          motionMode: 'transverse',
          tension: TENSION,
        }),
      })
      const m = assembleChain(spec)
      const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
      const n = nodeCount - 2
      const segmentLength = LENGTH / (nodeCount - 1)
      const base = 2 * Math.sqrt(TENSION / (MASS * segmentLength))
      for (let i = 0; i < n; i++) {
        const expected = base * Math.sin(((i + 1) * Math.PI) / (2 * (n + 1)))
        expect(analysis.modes[i]?.omega ?? 0).toBeCloseTo(expected, 6)
      }
    }
  })

  it('decouples the same way when an interior node is driven', () => {
    // Requirement one is a property of the assembly, so it must hold in either
    // regime without a second code path.
    const spec = transverseChain({
      ...uniformChain({
        nodeCount: NODE_COUNT,
        length: LENGTH,
        totalStiffness: 100,
        totalDamping: 0.09,
        mass: MASS,
        drivenNodes: [0, 5, NODE_COUNT - 1],
        motionMode: 'transverse',
        tension: TENSION,
      }),
    })
    const sim = new Simulation(spec)
    expect(sim.dof).toBe(8)
    const frequencies = Array.from(sim.naturalFrequencies)
    for (let i = 0; i < 8; i += 2) {
      expect(frequencies[i + 1] as number).toBeCloseTo(frequencies[i] as number, 9)
    }
  })
})

describe('transverse damping', () => {
  it('keeps the dashpots proportional, so the system stays classically damped', () => {
    // Both the tension law and the damping law go as inverse length, so c/k
    // stays uniform and the closed-form damping ratio still applies.
    const spec = transverseChain()
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    const alpha = segmentDamping(spec, 0) / segmentStiffness(spec, 0)

    expect(analysis.classicallyDamped).toBe(true)
    for (const mode of analysis.modes) {
      expect(mode.zeta).toBeCloseTo((alpha * mode.omega) / 2, 9)
    }
  })
})

describe('actuators are longitudinal only', () => {
  it('is reported as inapplicable in the transverse regime', () => {
    expect(actuatorsApply(transverseChain())).toBe(false)
    expect(actuatorsApply(setMotionMode(transverseChain(), 'longitudinal'))).toBe(true)
  })

  it('does nothing transversely, because a rest-length change is not a sideways push', () => {
    const spec = setSegmentActuator(transverseChain(), 3, step(0.004, 0, 0.05))
    const sim = new Simulation(spec)
    for (let i = 0; i < Math.round(4 / sim.timestep); i++) sim.step(sim.timestep)
    for (const displacement of sim.nodeDisplacements()) expect(displacement).toBe(0)
  })

  it('is cleared when switching into the transverse regime', () => {
    // Leaving one armed would present an active control that silently does
    // nothing, which is worse than removing it.
    const longitudinal = setSegmentActuator(
      setMotionMode(transverseChain(), 'longitudinal'),
      3,
      step(0.004, 0, 0.05),
    )
    expect(longitudinal.segments[3]?.actuator.kind).toBe('step')
    const transverse = setMotionMode(longitudinal, 'transverse')
    expect(transverse.segments[3]?.actuator.kind).toBe('off')
  })
})

describe('the other excitations carry over unchanged', () => {
  it('drives a transverse chain from a prescribed end motion', () => {
    const spec = transverseChain()
    const shaken: ChainSpec = {
      ...spec,
      nodes: spec.nodes.map((n, i) => (i === 0 ? { ...n, motion: sine(0.002, 20) } : n)),
    }
    const sim = new Simulation(shaken)
    for (let i = 0; i < Math.round(1 / sim.timestep); i++) sim.step(sim.timestep)
    let peak = 0
    for (const d of sim.nodeDisplacements()) peak = Math.max(peak, Math.abs(d))
    expect(peak).toBeGreaterThan(1e-5)
  })

  it('drives a transverse chain from a force on a free node', () => {
    const sim = new Simulation(setNodeForce(transverseChain(), 4, step(0.5, 0, 0.05)))
    for (let i = 0; i < Math.round(4 / sim.timestep); i++) sim.step(sim.timestep)
    expect(Math.abs(sim.nodeDisplacements()[4] as number)).toBeGreaterThan(1e-5)
  })
})

describe('switching regimes always leaves a chain the physics can describe', () => {
  // Regression: switching a longitudinal chain to transverse used to carry its
  // tension of zero across, producing a system with no restoring force. The
  // validator rejected it, the throw propagated out of a React effect, and the
  // whole app unmounted to a black screen.
  it('seeds tension when switching a longitudinal chain to transverse', () => {
    const longitudinal = uniformChain({
      nodeCount: NODE_COUNT,
      length: LENGTH,
      totalStiffness: 100,
      totalDamping: 0.09,
      mass: MASS,
      drivenNodes: [0, NODE_COUNT - 1],
    })
    expect(longitudinal.tension).toBe(0)

    const switched = setMotionMode(longitudinal, 'transverse')
    expect(switched.tension).toBeGreaterThan(0)
    expect(validateChain(switched)).toEqual([])
    expect(() => new Simulation(switched)).not.toThrow()
  })

  it('picks the tension that preserves the spectrum, so the pitch does not jump', () => {
    const longitudinal = uniformChain({
      nodeCount: NODE_COUNT,
      length: LENGTH,
      totalStiffness: 100,
      totalDamping: 0.09,
      mass: MASS,
      drivenNodes: [0, NODE_COUNT - 1],
    })
    const before = Array.from(new Simulation(longitudinal).naturalFrequencies)
    const after = Array.from(new Simulation(setMotionMode(longitudinal, 'transverse')).naturalFrequencies)
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i] as number).toBeCloseTo(before[i] as number, 9)
    }
  })

  it('round-trips between regimes without ever becoming invalid', () => {
    let spec: ChainSpec = uniformChain({
      nodeCount: 7,
      length: LENGTH,
      totalStiffness: 100,
      totalDamping: 0.09,
      mass: MASS,
      drivenNodes: [0, 6],
    })
    for (let i = 0; i < 6; i++) {
      spec = setMotionMode(spec, i % 2 === 0 ? 'transverse' : 'longitudinal')
      expect(validateChain(spec)).toEqual([])
      expect(() => new Simulation(spec)).not.toThrow()
    }
  })

  it('keeps a tension the user already chose', () => {
    const tuned = { ...transverseChain(), tension: 42 }
    const roundTripped = setMotionMode(setMotionMode(tuned, 'longitudinal'), 'transverse')
    expect(roundTripped.tension).toBe(42)
  })

  it('every scenario builds a chain the simulation accepts', () => {
    for (const preset of PRESETS) {
      const { spec } = preset.build()
      expect(validateChain(spec), `preset ${preset.id}`).toEqual([])
      expect(() => new Simulation(spec), `preset ${preset.id}`).not.toThrow()
    }
  })

  it('opens in the longitudinal regime, ready to run', () => {
    const spec = initialChain()
    expect(spec.motionMode).toBe('longitudinal')
    // Carrying no tension is correct here, not an oversight: longitudinal
    // motion is restored by the spring's own stiffness. The switch supplies a
    // tension if and when the transverse regime needs one.
    expect(spec.totalStiffness).toBeGreaterThan(0)
    expect(validateChain(spec)).toEqual([])
    const sim = new Simulation(spec)
    expect(sim.dof).toBe(NODE_COUNT - 2)
    expect(() => sim.advance(0.05)).not.toThrow()
    expect(validateChain(setMotionMode(spec, 'transverse'))).toEqual([])
  })
})
