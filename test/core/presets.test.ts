import { describe, expect, it } from 'vitest'
import { NODE_MASS, PRESETS, TETHER, defaultChain, naturalFrequenciesHz } from '../../src/ui/presets'
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

  it('grows only the mode it was seeded with, because the whole spring moves together', () => {
    // Modulating every segment identically makes K(t) a scalar multiple of K,
    // which preserves its eigenvectors: phi^T K(t) phi stays diagonal and the
    // modal equations stay decoupled. Seeded in mode 1, the chain stays purely
    // in mode 1. The single bar on screen is the correct answer, and the hint
    // says so, so it is pinned here.
    const { spec, startMode } = preset('parametric')
    const sim = new Simulation(spec)
    sim.setStateFromMode((startMode?.mode ?? 1) - 1, startMode?.amplitude ?? 0.0002)
    run(sim, 6)

    const amplitudes = sim.modalAmplitudes()
    const seeded = amplitudes[0] as number
    expect(seeded).toBeGreaterThan((startMode?.amplitude ?? 0.0002) * 2)
    for (let r = 1; r < amplitudes.length; r++) {
      // Rounding level, not merely small.
      expect((amplitudes[r] as number) / seeded).toBeLessThan(1e-12)
    }
  })

  it('couples the modes once a single segment is modulated instead', () => {
    // The other half of the same claim: a non-uniform K(t) is no longer a
    // scalar multiple, so it mixes the modes and energy leaves the seeded one.
    const { spec, startMode } = preset('parametric')
    const fundamental = naturalFrequenciesHz(defaultChain())[0] ?? 7
    const oneSegment = {
      ...spec,
      segments: spec.segments.map((s, i) =>
        i === 0 ? s : { ...s, stiffnessModulation: { kind: 'off' as const } },
      ),
    }
    const sim = new Simulation(oneSegment)
    sim.setStateFromMode(0, startMode?.amplitude ?? 0.0002)
    run(sim, 6)

    const amplitudes = sim.modalAmplitudes()
    const seeded = amplitudes[0] as number
    let strongestOther = 0
    for (let r = 1; r < amplitudes.length; r++) {
      strongestOther = Math.max(strongestOther, amplitudes[r] as number)
    }
    // Far above rounding: real coupling, not numerical noise.
    expect(strongestOther / seeded).toBeGreaterThan(1e-6)
    void fundamental
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

describe('preset: transverse plucked string', () => {
  function transversePreset() {
    const found = PRESETS.find((p) => p.id === 'transverse')
    if (found === undefined) throw new Error('missing preset')
    return found.build().spec
  }

  it('runs in the transverse regime', () => {
    expect(transversePreset().motionMode).toBe('transverse')
  })

  it('lands on exactly the longitudinal spectrum, by construction', () => {
    // Same frequencies from a completely different restoring mechanism. If this
    // drifts, the preset's central comparison stops being true.
    const transverse = naturalFrequenciesHz(transversePreset())
    const longitudinal = naturalFrequenciesHz(defaultChain())
    expect(transverse).toHaveLength(longitudinal.length)
    for (let i = 0; i < transverse.length; i++) {
      expect(transverse[i] as number).toBeCloseTo(longitudinal[i] as number, 9)
    }
  })

  it('retunes with tension and ignores stiffness entirely', () => {
    const base = transversePreset()
    const stiffer = naturalFrequenciesHz({ ...base, totalStiffness: base.totalStiffness * 8 })
    const tighter = naturalFrequenciesHz({ ...base, tension: base.tension * 4 })
    const original = naturalFrequenciesHz(base)

    for (let i = 0; i < original.length; i++) {
      expect(stiffer[i] as number).toBeCloseTo(original[i] as number, 9)
      // Frequency goes as sqrt(T), so four times the tension doubles it.
      expect(tighter[i] as number).toBeCloseTo(2 * (original[i] as number), 9)
    }
  })
})

describe('diatomic chain', () => {
  it('opens a band gap with nothing at all inside it', () => {
    // The hint claims ten modes from 3 to 27 Hz, ten more from 46 to 53, and
    // nothing between. All three halves of that are checked here.
    const frequencies = naturalFrequenciesHz(preset('diatomic').spec)
    expect(frequencies).toHaveLength(20)

    const acoustic = frequencies.filter((f) => f < 30)
    const optical = frequencies.filter((f) => f > 40)
    expect(acoustic).toHaveLength(10)
    expect(optical).toHaveLength(10)

    expect(Math.min(...acoustic)).toBeGreaterThan(3)
    expect(Math.max(...acoustic)).toBeLessThan(27)
    expect(Math.min(...optical)).toBeGreaterThan(46)
    expect(Math.max(...optical)).toBeLessThan(54)
    expect(frequencies.filter((f) => f >= 27 && f <= 46)).toEqual([])
  })
})

describe('light defect', () => {
  it('splits one mode above where the perfect chain stops', () => {
    const spec = preset('light-defect').spec
    const perfect: typeof spec = {
      ...spec,
      nodes: spec.nodes.map((n, i) => (i === 10 ? { ...n, mass: NODE_MASS } : n)),
    }
    const defective = naturalFrequenciesHz(spec)
    const band = naturalFrequenciesHz(perfect)

    // 96 Hz against a band that stops at 64: one mode, well clear of the top.
    expect(Math.max(...band)).toBeGreaterThan(60)
    expect(Math.max(...band)).toBeLessThan(66)
    expect(Math.max(...defective)).toBeGreaterThan(90)
    expect(defective.filter((f) => f > Math.max(...band) + 1)).toHaveLength(1)
  })

  it('localises that mode on the defect', () => {
    const sim = new Simulation(preset('light-defect').spec)
    const shapes = sim.modeShapes
    const top = sim.dof - 1
    // Ends are driven, so free node i is degree of freedom i - 1.
    const at = (node: number): number => Math.abs(shapes.get(node - 1, top))

    expect(at(10)).toBeGreaterThan(4 * at(8))
    expect(at(8)).toBeGreaterThan(at(6))
    expect(at(10)).toBeGreaterThan(20 * at(5))
  })
})

describe('tethered chain', () => {
  it('lifts every mode above the cutoff', () => {
    const frequencies = naturalFrequenciesHz(preset('tethered').spec)
    const cutoff = Math.sqrt(TETHER / NODE_MASS) / (2 * Math.PI)

    expect(cutoff).toBeGreaterThan(31)
    expect(cutoff).toBeLessThan(33)
    expect(Math.min(...frequencies)).toBeGreaterThan(cutoff)
    expect(Math.min(...frequencies)).toBeLessThan(34)
    // The same chain untethered starts far below it.
    expect(naturalFrequenciesHz(defaultChain())[0] as number).toBeLessThan(8)
  })

  it('drives below the cutoff and the motion dies away at the evanescent rate', () => {
    // Not damped away -- there is simply no mode down there to carry it. Below
    // the cutoff the wavenumber goes imaginary, q = i.kappa, and the standing
    // profile falls by exp(kappa.a) per node, from
    //
    //   omega^2 = omega_0^2 - (4k/m) sinh^2(kappa.a / 2)
    //
    // which for this chain driven at 20 Hz is a factor of 2.85 each step along.
    const sim = new Simulation(preset('tethered').spec)
    const drive = 2 * Math.PI * 20
    const cutoffSquared = TETHER / NODE_MASS
    const coupling = (4 * segmentStiffness(sim.chain, 0)) / NODE_MASS
    const kappaA = 2 * Math.asinh(Math.sqrt((cutoffSquared - drive ** 2) / coupling))
    const perNode = Math.exp(kappaA)

    // The start of a sine is a step in velocity, which rings every mode the
    // chain does have. Those propagate, so the profile only becomes evanescent
    // once that transient is gone.
    run(sim, 6)

    const peak = new Float64Array(sim.chain.nodes.length)
    for (let s = 0; s < 700; s++) {
      sim.step(sim.timestep)
      const displacement = sim.nodeDisplacements()
      for (let i = 0; i < peak.length; i++) {
        peak[i] = Math.max(peak[i] as number, Math.abs(displacement[i] as number))
      }
    }

    expect(perNode).toBeCloseTo(2.85, 1)
    const measured = ((peak[1] as number) / (peak[4] as number)) ** (1 / 3)
    expect(measured).toBeGreaterThan(perNode * 0.95)
    expect(measured).toBeLessThan(perNode * 1.05)
  })
})

describe('matched end', () => {
  it('rings up far less than the same chain with a reflecting end', () => {
    const matched = preset('matched-end').spec
    const reflecting: typeof matched = {
      ...matched,
      nodes: matched.nodes.map((n) => ({ ...n, groundDamping: 0 })),
    }
    const peakEnergy = (spec: typeof matched): number => {
      const sim = new Simulation(spec)
      let peak = 0
      for (let s = 0; s < 6000; s++) {
        sim.step(sim.timestep)
        peak = Math.max(peak, sim.energy())
      }
      return peak
    }
    expect(peakEnergy(matched)).toBeLessThan(peakEnergy(reflecting) / 5)
  })
})

describe('non-proportional damping', () => {
  it('is not classically damped, and leaks out of the mode it started in', () => {
    const { spec, startMode } = preset('non-proportional-damping')
    const sim = new Simulation(spec)
    expect(sim.modalAnalysis.classicallyDamped).toBe(false)
    expect(sim.modalAnalysis.nonProportionality).toBeGreaterThan(0.01)

    const seeded = startMode?.mode ?? 3
    const leak = (simulation: Simulation): number => {
      simulation.setStateFromMode(seeded - 1, 0.003)
      const start = simulation.modalAmplitudes()[seeded - 1] as number
      let other = 0
      for (let s = 0; s < 400; s++) {
        run(simulation, 0.002)
        const amplitudes = simulation.modalAmplitudes()
        for (let r = 0; r < amplitudes.length; r++) {
          if (r !== seeded - 1) other = Math.max(other, amplitudes[r] as number)
        }
      }
      return other / start
    }

    // Evenly damped, the other modes stay dark for as long as you watch.
    expect(leak(new Simulation(defaultChain()))).toBeLessThan(1e-6)
    expect(leak(sim)).toBeGreaterThan(0.01)
  })
})
