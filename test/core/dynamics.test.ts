import { describe, expect, it } from 'vitest'
import {
  segmentDamping,
  segmentStiffness,
  uniformChain,
  type ChainSpec,
} from '../../src/core/chain'
import { Simulation } from '../../src/core/simulation'
import { OFF, evaluateSignal, sine, step, chirp, type SignalSpec } from '../../src/core/signal'

const MASS = 0.05

function withNode(spec: ChainSpec, index: number, patch: Partial<ChainSpec['nodes'][number]>): ChainSpec {
  return { ...spec, nodes: spec.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)) }
}

function withSegment(
  spec: ChainSpec,
  index: number,
  patch: Partial<ChainSpec['segments'][number]>,
): ChainSpec {
  return { ...spec, segments: spec.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
}

/** The brief's starting point: one free node between two driven ones. */
function singleFreeNode(totalDamping = 0): ChainSpec {
  return uniformChain({
    nodeCount: 3,
    length: 1,
    totalStiffness: 100,
    totalDamping,
    mass: MASS,
    drivenNodes: [0, 2],
  })
}

function runFor(sim: Simulation, seconds: number): void {
  const dt = sim.timestep
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) sim.step(dt)
}

describe('signals carry their exact analytical derivative', () => {
  const specs: readonly [string, SignalSpec][] = [
    ['sine', sine(0.003, 23.5, 0.7)],
    ['chirp mid-sweep', chirp(0.002, 5, 60, 4, 0.25, 0.3)],
    ['chirp before sweep', chirp(0.002, 5, 60, 4, 5, 0.3)],
    ['chirp after sweep', chirp(0.002, 5, 60, 1, 0, 0.3)],
    ['step mid-ramp', step(0.004, 0.1, 0.5)],
  ]

  it.each(specs)('%s matches a central difference', (_label, spec) => {
    const h = 1e-7
    for (const t of [0.05, 0.3, 0.62, 1.4, 2.9]) {
      const numerical =
        (evaluateSignal(spec, t + h).value - evaluateSignal(spec, t - h).value) / (2 * h)
      const analytical = evaluateSignal(spec, t).derivative
      expect(analytical).toBeCloseTo(numerical, 4)
    }
  })

  /**
   * Continuity test that actually distinguishes continuous from discontinuous.
   *
   * Sampling either side of a join always shows a gap of roughly 2.eps.f'(t),
   * so a small gap proves nothing on its own. What separates the two cases is
   * how the gap behaves as eps shrinks: across a continuous join it falls off
   * linearly, across a genuine step it stays put.
   */
  function jumpShrinksLinearly(join: number, read: (t: number) => number): void {
    const coarse = Math.abs(read(join + 1e-6) - read(join - 1e-6))
    const fine = Math.abs(read(join + 1e-8) - read(join - 1e-8))
    const floor = 1e-18
    expect(fine + floor).toBeLessThan((coarse + floor) / 50)
  }

  it('keeps the chirp continuous in value and slope across both sweep joins', () => {
    const spec = chirp(0.002, 5, 60, 2, 1, 0)
    for (const join of [1, 3]) {
      // A jump in value would be an infinite velocity through the dashpots; a
      // jump in slope would be an impulsive dashpot force.
      jumpShrinksLinearly(join, (t) => evaluateSignal(spec, t).value)
      jumpShrinksLinearly(join, (t) => evaluateSignal(spec, t).derivative)
    }
  })

  it('keeps the step continuous in value and slope at both ends of its ramp', () => {
    const spec = step(0.004, 1, 0.5)
    for (const join of [1, 1.5]) {
      jumpShrinksLinearly(join, (t) => evaluateSignal(spec, t).value)
      jumpShrinksLinearly(join, (t) => evaluateSignal(spec, t).derivative)
    }
  })

  it('detects a real discontinuity, so the test above can fail', () => {
    // A zero rise time is a genuine jump. If jumpShrinksLinearly passed here it
    // would be proving nothing about the smooth signals.
    const discontinuous = step(0.004, 1, 0)
    expect(() =>
      jumpShrinksLinearly(1, (t) => evaluateSignal(discontinuous, t).value),
    ).toThrow()
  })
})

describe('single free node between two driven ones', () => {
  it('rings at the analytical undamped frequency', () => {
    const spec = singleFreeNode()
    const sim = new Simulation(spec)
    // Two segments pull on the one free mass, so omega = sqrt(2k/m).
    const expected = Math.sqrt((2 * segmentStiffness(spec, 0)) / MASS)
    expect(sim.dof).toBe(1)
    expect(sim.undampedModes.omega[0]).toBeCloseTo(expected, 9)
  })

  it('reproduces the analytical damped free decay', () => {
    const spec = singleFreeNode(0.5)
    const sim = new Simulation(spec)

    const k = 2 * segmentStiffness(spec, 0)
    const c = 2 * segmentDamping(spec, 0)
    const omega = Math.sqrt(k / MASS)
    const zeta = c / (2 * Math.sqrt(k * MASS))
    const omegaD = omega * Math.sqrt(1 - zeta * zeta)
    expect(zeta).toBeGreaterThan(0)
    expect(zeta).toBeLessThan(1)

    const amplitude = 0.002
    sim.setStateFromMode(0, amplitude)

    // Released from rest at maximum displacement. The comparison uses the
    // simulation's own clock rather than the requested duration: a fixed
    // timestep lands on a whole number of steps, so the two differ by up to
    // half a step, which at these velocities dwarfs the integration error.
    for (const requested of [0.01, 0.05, 0.12, 0.3]) {
      const sim2 = new Simulation(spec)
      sim2.setStateFromMode(0, amplitude)
      runFor(sim2, requested)
      const t = sim2.time
      const analytical =
        amplitude *
        Math.exp(-zeta * omega * t) *
        (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t))
      // RK4 at forty steps per period carries a local error near 1e-6 of the
      // amplitude per step, so this is agreement to the integrator's accuracy.
      expect(sim2.nodeDisplacements()[1] as number).toBeCloseTo(analytical, 7)
    }
  })

  it('conserves energy without damping', () => {
    const sim = new Simulation(singleFreeNode())
    sim.setStateFromMode(0, 0.002)
    const initial = sim.energy()
    runFor(sim, 2)
    // RK4 is not symplectic, so amplitude decays slowly even with no dashpot.
    // Its per-step amplification is |R(i.theta)| ~ 1 - theta^6/72 with
    // theta = omega.h ~ 0.157, giving about 2e-7 per step; over roughly 1100
    // steps that predicts a few parts in ten thousand, which is what we see.
    // Bounding it is meaningful, asserting it away would not be.
    const drift = Math.abs(sim.energy() - initial) / initial
    expect(drift).toBeLessThan(1e-3)
    expect(sim.energy()).toBeLessThan(initial)
  })

  it('loses energy monotonically with damping', () => {
    const sim = new Simulation(singleFreeNode(0.5))
    sim.setStateFromMode(0, 0.002)
    let previous = sim.energy()
    for (let i = 0; i < 20; i++) {
      runFor(sim, 0.02)
      const now = sim.energy()
      expect(now).toBeLessThan(previous)
      previous = now
    }
  })
})

describe('prescribed motion enters through the force vector correctly', () => {
  it('translates the whole chain rigidly when both ends are moved together', () => {
    // Steady state of K_ff.x = -K_fd.u for a uniform displacement u must be the
    // same uniform displacement, because every row of the full K sums to zero.
    // A sign or magnitude error in the K_fd term breaks this immediately.
    const offset = 0.003
    const base = uniformChain({
      nodeCount: 7,
      length: 1,
      totalStiffness: 100,
      totalDamping: 3,
      mass: MASS,
      drivenNodes: [0, 6],
      motion: step(offset, 0, 0.02),
    })
    const sim = new Simulation(base)
    runFor(sim, 6)

    for (const d of sim.nodeDisplacements()) expect(d).toBeCloseTo(offset, 7)
    for (const e of sim.segmentExtensions()) expect(e).toBeCloseTo(0, 7)
  })

  it('needs the prescribed velocity, not just the position', () => {
    // With a moving boundary the dashpot term C_fd.udot is the only thing
    // distinguishing a correct force vector from one that ignores it. Driving
    // well below the first natural frequency, the chain should follow the
    // boundary almost exactly; dropping the velocity term produces a visible
    // lag instead.
    const spec = uniformChain({
      nodeCount: 5,
      length: 1,
      totalStiffness: 100,
      totalDamping: 8,
      mass: MASS,
      drivenNodes: [0, 4],
      motion: sine(0.002, 0.5),
    })
    const sim = new Simulation(spec)
    runFor(sim, 4)
    const displacement = sim.nodeDisplacements()
    const boundary = displacement[0] as number
    for (const d of displacement) expect(d).toBeCloseTo(boundary, 5)
  })
})

describe('driving an interior node decouples the chain dynamically', () => {
  it('leaves the far sub-chain exactly untouched', () => {
    // Node 5 is driven but held still, so it is a wall. Shaking node 0 must
    // excite nodes 1-4 and leave nodes 6-9 at precisely zero -- not merely
    // small. This is the dynamic counterpart of the block-diagonal K test.
    const spec = uniformChain({
      nodeCount: 11,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0.5,
      mass: MASS,
      drivenNodes: [0, 5, 10],
    })
    const shaken = withNode(spec, 0, { motion: sine(0.002, 20) })
    const sim = new Simulation(shaken)
    runFor(sim, 1)

    const displacement = sim.nodeDisplacements()
    let nearMotion = 0
    for (let i = 1; i <= 4; i++) nearMotion = Math.max(nearMotion, Math.abs(displacement[i] as number))
    expect(nearMotion).toBeGreaterThan(1e-5)

    for (let i = 6; i <= 9; i++) expect(displacement[i]).toBe(0)
  })
})

describe('actuators modulate rest length from inside a segment', () => {
  it('produces the analytical static deflection', () => {
    // One free node, actuator lengthening segment 0 by delta. Statics give
    // (k0 + k1).x = k0.delta, so with equal segments x settles at delta/2.
    const delta = 0.004
    const spec = withSegment(singleFreeNode(2), 0, { actuator: step(delta, 0, 0.05) })
    const sim = new Simulation(spec)
    runFor(sim, 8)
    expect(sim.nodeDisplacements()[1] as number).toBeCloseTo(delta / 2, 8)
  })

  it('pushes its two end nodes apart, not together', () => {
    // Lengthening the middle segment of a five-node chain must move the node
    // below it down and the node above it up. A sign error here would show as
    // both moving the same way.
    const spec = withSegment(
      uniformChain({
        nodeCount: 5,
        length: 1,
        totalStiffness: 100,
        totalDamping: 3,
        mass: MASS,
        drivenNodes: [0, 4],
      }),
      1,
      { actuator: step(0.004, 0, 0.05) },
    )
    const sim = new Simulation(spec)
    runFor(sim, 8)
    const displacement = sim.nodeDisplacements()
    expect(displacement[1] as number).toBeLessThan(0)
    expect(displacement[2] as number).toBeGreaterThan(0)
  })
})

describe('modal initial conditions stay in their own mode', () => {
  it('rings at exactly that mode frequency and excites no other', () => {
    const spec = uniformChain({
      nodeCount: 11,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0,
      mass: MASS,
      drivenNodes: [0, 10],
    })
    const sim = new Simulation(spec)
    const mode = 3
    sim.setStateFromMode(mode, 0.002)

    const amplitudes = sim.modalAmplitudes()
    for (let r = 0; r < amplitudes.length; r++) {
      if (r === mode) expect(amplitudes[r] as number).toBeGreaterThan(1e-4)
      else expect(amplitudes[r] as number).toBeLessThan(1e-15)
    }

    // An undamped chain released from rest in mode r has the closed-form
    // solution x(t) = A . phi_r . cos(omega_r . t). Comparing against that at
    // the simulation's own clock tests the frequency directly, rather than
    // testing whether a whole number of fixed steps happens to land on a
    // period boundary -- it does not, and that rounding would swamp the result.
    const omega = sim.undampedModes.omega[mode] as number
    const shape = sim.undampedModes.shapes
    const { dof, freeIndices } = sim.chainMatrices

    let peakShape = 0
    for (let i = 0; i < dof; i++) peakShape = Math.max(peakShape, Math.abs(shape.get(i, mode)))

    runFor(sim, (2 * Math.PI) / omega)
    const after = sim.nodeDisplacements()
    for (let a = 0; a < dof; a++) {
      const expected = 0.002 * (shape.get(a, mode) / peakShape) * Math.cos(omega * sim.time)
      // Agreement to a few parts in ten million of the amplitude after a full
      // period: this is RK4's own truncation error, nothing else.
      expect(after[freeIndices[a] as number] as number).toBeCloseTo(expected, 8)
    }

    // The strong claim, and the one that is exact: modal orthogonality means no
    // other mode can ever be excited, however long this runs.
    runFor(sim, 0.4)
    const later = sim.modalAmplitudes()
    for (let r = 0; r < later.length; r++) {
      if (r === mode) expect(later[r] as number).toBeGreaterThan(1e-4)
      else expect(later[r] as number).toBeLessThan(1e-14)
    }
  })
})

describe('external forces', () => {
  it('act on free nodes and are absorbed at driven ones', () => {
    const spec = uniformChain({
      nodeCount: 5,
      length: 1,
      totalStiffness: 100,
      totalDamping: 3,
      mass: MASS,
      drivenNodes: [0, 4],
    })

    const pushed = new Simulation(withNode(spec, 2, { force: step(1.5, 0, 0.05) }))
    runFor(pushed, 8)
    expect(pushed.nodeDisplacements()[2] as number).toBeGreaterThan(1e-4)

    // The same force on a driven node does nothing: its motion is prescribed.
    const ignored = new Simulation(withNode(spec, 0, { force: step(1.5, 0, 0.05) }))
    runFor(ignored, 8)
    for (const d of ignored.nodeDisplacements()) expect(d).toBe(0)
  })
})

describe('live editing', () => {
  it('carries node state across a free-to-driven switch without a jolt', () => {
    const spec = uniformChain({
      nodeCount: 7,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0.2,
      mass: MASS,
      drivenNodes: [0, 6],
    })
    const sim = new Simulation(spec)
    sim.setStateFromMode(1, 0.002)
    runFor(sim, 0.01)

    const before = sim.nodeDisplacements().slice()
    sim.setChain(withNode(spec, 2, { driven: true, motion: OFF }))
    const after = sim.nodeDisplacements()

    expect(sim.dof).toBe(4)
    // Every still-free node keeps exactly the displacement it had.
    for (const i of [1, 3, 4, 5]) expect(after[i]).toBe(before[i])
  })

  it('recomputes the degree-of-freedom count from the new chain', () => {
    const spec = uniformChain({
      nodeCount: 11,
      length: 1,
      totalStiffness: 100,
      totalDamping: 0,
      mass: MASS,
      drivenNodes: [0, 10],
    })
    const sim = new Simulation(spec)
    expect(sim.dof).toBe(9)
    sim.setChain(uniformChain({
      nodeCount: 11, length: 1, totalStiffness: 100, totalDamping: 0, mass: MASS,
      drivenNodes: [0, 3, 7, 10],
    }))
    expect(sim.dof).toBe(7)
  })
})

describe('fixed timestep', () => {
  it('gives frame-rate-independent results', () => {
    // The same simulated interval delivered as one big chunk, as sixty small
    // ones, and as ragged jittery ones must land in the same place.
    const spec = uniformChain({
      nodeCount: 9, length: 1, totalStiffness: 100, totalDamping: 0.4, mass: MASS,
      drivenNodes: [0, 8], motion: sine(0.002, 12),
    })
    const total = 0.5

    // A generous substep budget, so this measures chunking rather than the
    // spiral-of-death guard, which has its own test below.
    const options = { maxStepsPerFrame: 100000 }

    const one = new Simulation(spec, options)
    one.advance(total)

    const many = new Simulation(spec, options)
    for (let i = 0; i < 60; i++) many.advance(total / 60)

    const jittery = new Simulation(spec, options)
    let remaining = total
    let seed = 1
    while (remaining > 0) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const chunk = Math.min(remaining, (seed / 2147483648) * 0.03)
      jittery.advance(chunk)
      remaining -= chunk
    }

    expect(many.time).toBeCloseTo(one.time, 9)
    expect(jittery.time).toBeCloseTo(one.time, 9)

    const a = one.nodeDisplacements()
    const b = many.nodeDisplacements()
    const c = jittery.nodeDisplacements()
    for (let i = 0; i < a.length; i++) {
      // Differences come only from where each run's accumulator happens to sit,
      // never from how the interval was chopped up.
      expect(b[i] as number).toBeCloseTo(a[i] as number, 9)
      expect(c[i] as number).toBeCloseTo(a[i] as number, 9)
    }
  })

  it('caps substeps per frame rather than spiralling, and reports the loss', () => {
    // A frame asking for far more simulated time than the budget allows must
    // fall behind real time instead of locking the page up.
    const spec = uniformChain({
      nodeCount: 9, length: 1, totalStiffness: 100, totalDamping: 0.4, mass: MASS,
      drivenNodes: [0, 8],
    })
    const sim = new Simulation(spec, { maxStepsPerFrame: 50 })
    sim.advance(10)
    expect(sim.diagnostics.steps).toBe(50)
    expect(sim.diagnostics.droppedSeconds).toBeGreaterThan(0)
    expect(sim.time).toBeCloseTo(50 * sim.timestep, 9)

    // And the accumulator is cleared, so the next frame starts fresh rather
    // than inheriting an ever-growing backlog.
    sim.advance(0)
    expect(sim.diagnostics.steps).toBe(0)
  })
})
