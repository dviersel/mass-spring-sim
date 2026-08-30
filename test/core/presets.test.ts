import { describe, expect, it } from 'vitest'
import { PRESETS, defaultChain, naturalFrequenciesHz } from '../../src/ui/presets'
import { Simulation } from '../../src/core/simulation'
import { hasTimeVaryingStiffness, segmentStiffness } from '../../src/core/chain'
import { resizeChain } from '../../src/core/edit'

/**
 * The presets make specific physical claims in their on-screen hints. Each one
 * is checked here by actually running it, so a hint cannot quietly become a lie
 * when a default changes.
 */

function run(sim: Simulation, seconds: number): void {
  const steps = Math.round(seconds / sim.timestep)
  for (let i = 0; i < steps; i++) sim.step(sim.timestep)
}

function preset(id: string) {
  const found = PRESETS.find((p) => p.id === id)
  if (found === undefined) throw new Error(`no preset ${id}`)
  return found.build()
}

/** Peak modal amplitude reached by each mode over a run. */
function peakAmplitudes(sim: Simulation, seconds: number, samples = 400): Float64Array {
  const peak = new Float64Array(sim.dof)
  const slice = seconds / samples
  for (let s = 0; s < samples; s++) {
    run(sim, slice)
    const amplitudes = sim.modalAmplitudes()
    for (let r = 0; r < peak.length; r++) {
      peak[r] = Math.max(peak[r] as number, amplitudes[r] as number)
    }
  }
  return peak
}

describe('default chain', () => {
  it('lands in the tens-of-hertz band with millimetre-scale motion', () => {
    const frequencies = naturalFrequenciesHz(defaultChain())
    expect(frequencies).toHaveLength(9)
    expect(frequencies[0]).toBeGreaterThan(5)
    expect(frequencies[8]).toBeLessThan(60)
  })

  it('is lightly enough damped that the fundamental rings', () => {
    const sim = new Simulation(defaultChain())
    const first = sim.modalAnalysis.modes[0]
    expect(first?.zeta).toBeGreaterThan(0.005)
    expect(first?.zeta).toBeLessThan(0.05)
  })
})

describe('preset: mode 3, released', () => {
  it('starts with only mode 3 excited', () => {
    const { spec, startMode } = preset('mode-3')
    const sim = new Simulation(spec)
    expect(startMode?.mode).toBe(3)
    sim.setStateFromMode(2, startMode?.amplitude ?? 0.003)

    const amplitudes = sim.modalAmplitudes()
    for (let r = 0; r < amplitudes.length; r++) {
      if (r === 2) expect(amplitudes[r] as number).toBeGreaterThan(1e-4)
      else expect(amplitudes[r] as number).toBeLessThan(1e-14)
    }
  })

  it('decays, and stays in its own mode while it does', () => {
    const { spec, startMode } = preset('mode-3')
    const sim = new Simulation(spec)
    sim.setStateFromMode(2, startMode?.amplitude ?? 0.003)
    const before = sim.energy()
    run(sim, 1)
    expect(sim.energy()).toBeLessThan(before * 0.7)

    const amplitudes = sim.modalAmplitudes()
    for (let r = 0; r < amplitudes.length; r++) {
      if (r !== 2) expect(amplitudes[r] as number).toBeLessThan(1e-14)
    }
  })
})

describe('preset: chirp sweep', () => {
  it('excites every mode as it passes, with none left dark', () => {
    const { spec } = preset('sweep')
    const sim = new Simulation(spec)
    const peak = peakAmplitudes(sim, 50)
    const largest = Math.max(...peak)
    for (let r = 0; r < peak.length; r++) {
      // Modes differ in damping and in how long the sweep dwells near each, so
      // their peaks legitimately span a couple of decades. What matters is the
      // contrast with the symmetry presets, where blocked modes sit nine
      // decades down: nothing here is structurally blocked.
      expect((peak[r] as number) / largest).toBeGreaterThan(5e-3)
    }
  })
})

describe('preset: centre force leaves even modes dark', () => {
  it('drives the odd modes and never the even ones', () => {
    const { spec } = preset('centre-force')
    const sim = new Simulation(spec)
    const peak = peakAmplitudes(sim, 50)
    const oddPeak = Math.max(peak[0] as number, peak[2] as number, peak[4] as number)

    for (const evenMode of [2, 4, 6, 8]) {
      // Modes are 1-based in the hint; index is one less.
      expect((peak[evenMode - 1] as number) / oddPeak).toBeLessThan(1e-9)
    }
    for (const oddMode of [1, 3, 5, 7, 9]) {
      expect((peak[oddMode - 1] as number) / oddPeak).toBeGreaterThan(1e-3)
    }
  })
})

describe('preset: actuator blind spot', () => {
  it('cannot reach modes 2 and 6, but reaches the rest', () => {
    const { spec } = preset('actuator-blind-spot')
    const sim = new Simulation(spec)
    const peak = peakAmplitudes(sim, 50)
    const largest = Math.max(...peak)

    for (const dark of [2, 6]) {
      expect((peak[dark - 1] as number) / largest).toBeLessThan(1e-9)
    }
    for (const lit of [1, 3, 4, 5, 7, 8, 9]) {
      expect((peak[lit - 1] as number) / largest).toBeGreaterThan(1e-3)
    }
  })
})

describe('preset: node 5 driven splits the chain', () => {
  it('leaves the far half at exactly zero while the near half resonates', () => {
    const { spec } = preset('split-chain')
    const sim = new Simulation(spec)
    run(sim, 3)
    const displacement = sim.nodeDisplacements()

    let near = 0
    for (let i = 1; i <= 4; i++) near = Math.max(near, Math.abs(displacement[i] as number))
    expect(near).toBeGreaterThan(1e-4)

    for (let i = 6; i <= 9; i++) expect(displacement[i]).toBe(0)
  })

  it('has every frequency appearing exactly twice', () => {
    const { spec } = preset('split-chain')
    const frequencies = naturalFrequenciesHz(spec)
    expect(frequencies).toHaveLength(8)
    for (let i = 0; i < 8; i += 2) {
      expect(frequencies[i + 1] as number).toBeCloseTo(frequencies[i] as number, 9)
    }
  })
})

describe('preset: parametric pump', () => {
  it('is flagged as the time-varying-stiffness regime', () => {
    const { spec } = preset('parametric')
    expect(hasTimeVaryingStiffness(spec)).toBe(true)
    expect(new Simulation(spec).modalAnalysisIsValid).toBe(false)
  })

  it('actually pumps energy in, with no force and no imposed motion', () => {
    // Every node's motion and force is off: the only thing acting is a segment
    // stiffening and softening. If energy still grows, that is parametric
    // excitation and nothing else.
    const { spec, startMode } = preset('parametric')
    for (const node of spec.nodes) {
      expect(node.force.kind).toBe('off')
      expect(node.motion.kind).toBe('off')
    }

    const sim = new Simulation(spec)
    sim.setStateFromMode((startMode?.mode ?? 1) - 1, startMode?.amplitude ?? 0.0002)
    const initial = sim.energy()
    run(sim, 6)
    expect(sim.energy()).toBeGreaterThan(initial * 4)
  })

  it('pumps at twice the fundamental and not at the fundamental itself', () => {
    // The signature of parametric resonance: modulating at 2f grows the mode,
    // modulating at f does not. Getting this backwards would make the preset
    // teach the wrong thing.
    const { spec, startMode } = preset('parametric')
    const fundamental = naturalFrequenciesHz(defaultChain())[0] ?? 7
    const amplitude = startMode?.amplitude ?? 0.0002

    const growth = (frequency: number): number => {
      const tuned = {
        ...spec,
        segments: spec.segments.map((s) =>
          s.stiffnessModulation.kind === 'sine'
            ? { ...s, stiffnessModulation: { ...s.stiffnessModulation, frequency } }
            : s,
        ),
      }
      const sim = new Simulation(tuned)
      sim.setStateFromMode(0, amplitude)
      const initial = sim.energy()
      run(sim, 6)
      return sim.energy() / initial
    }

    expect(growth(2 * fundamental)).toBeGreaterThan(4)
    expect(growth(fundamental)).toBeLessThan(1)
  })
})

describe('preset: simplest case, one free mass', () => {
  it('has exactly one degree of freedom and one mode', () => {
    const found = PRESETS.find((p) => p.id === 'single-mass')
    if (found === undefined) throw new Error('missing preset')
    const sim = new Simulation(found.build().spec)
    expect(sim.dof).toBe(1)
    expect(sim.modalAnalysis.modes).toHaveLength(1)
  })

  it('rings at sqrt(2k/m), the analytical answer for two springs on one mass', () => {
    const found = PRESETS.find((p) => p.id === 'single-mass')
    if (found === undefined) throw new Error('missing preset')
    const spec = found.build().spec
    const sim = new Simulation(spec)
    const expected = Math.sqrt((2 * segmentStiffness(spec, 0)) / (spec.nodes[1]?.mass ?? 1))
    expect(sim.naturalFrequencies[0]).toBeCloseTo(expected, 9)
  })
})

describe('resizing the chain', () => {
  it('derives the degree-of-freedom count rather than assuming nine', () => {
    // Requirement one, exercised end to end: the same code path handles every
    // size, so this is an ordinary edit and not a special case.
    let spec = defaultChain()
    for (const [nodeCount, expectedDof] of [
      [3, 1],
      [6, 4],
      [11, 9],
      [21, 19],
      [2, 0],
    ] as const) {
      spec = resizeChain(spec, nodeCount)
      const sim = new Simulation(spec)
      expect(sim.dof).toBe(expectedDof)
      expect(sim.modalAnalysis.modes).toHaveLength(expectedDof)
    }
  })

  it('matches the analytical dispersion relation at every size', () => {
    for (const nodeCount of [3, 5, 8, 12, 17]) {
      const spec = resizeChain(defaultChain(), nodeCount)
      const sim = new Simulation(spec)
      const n = nodeCount - 2
      const k = segmentStiffness(spec, 0)
      const m = spec.nodes[1]?.mass ?? 1
      for (let i = 0; i < n; i++) {
        const expected = 2 * Math.sqrt(k / m) * Math.sin(((i + 1) * Math.PI) / (2 * (n + 1)))
        expect(sim.naturalFrequencies[i] as number).toBeCloseTo(expected, 6)
      }
    }
  })

  it('survives a chain with no free nodes at all', () => {
    // Two driven ends and nothing between them is a degenerate but reachable
    // state from the UI, and it must not throw or produce NaN.
    const sim = new Simulation(resizeChain(defaultChain(), 2))
    expect(sim.dof).toBe(0)
    expect(() => sim.advance(0.1)).not.toThrow()
    expect(sim.energy()).toBe(0)
    expect(sim.modalAmplitudes()).toHaveLength(0)
  })
})
