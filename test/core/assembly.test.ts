import { describe, expect, it } from 'vitest'
import { assembleChain, rebuildStiffnessInPlace, stiffnessScaleAt } from '../../src/core/assemble'
import {
  quietSegment,
  segmentDamping,
  segmentStiffness,
  uniformChain,
  type ChainSpec,
} from '../../src/core/chain'
import { sine } from '../../src/core/signal'

const base = () =>
  uniformChain({
    nodeCount: 6,
    length: 1,
    totalStiffness: 100,
    totalDamping: 2,
    mass: 0.05,
    drivenNodes: [0, 5],
  })

/** Same chain, but with node positions bunched towards one end. */
function unevenChain(): ChainSpec {
  const positions = [0, 0.05, 0.2, 0.55, 0.8, 1.0]
  return {
    nodes: positions.map((position, i) => ({
      position,
      mass: 0.05,
      driven: i === 0 || i === positions.length - 1,
      motion: { kind: 'off' as const },
      force: { kind: 'off' as const },
    })),
    segments: positions.slice(1).map(() => quietSegment()),
    motionMode: 'longitudinal',
    tension: 0,
    totalStiffness: 100,
    totalDamping: 2,
  }
}

describe('unequal spacing', () => {
  const spec = unevenChain()

  it('makes short segments proportionally stiffer and more damped', () => {
    // Segment 0 spans 0.05 m and segment 3 spans 0.25 m, so segment 0 must be
    // five times as stiff. Both follow the same inverse-length law.
    expect(segmentStiffness(spec, 0) / segmentStiffness(spec, 3)).toBeCloseTo(5, 10)
    expect(segmentDamping(spec, 0) / segmentDamping(spec, 3)).toBeCloseTo(5, 10)
  })

  it('still reproduces the total stiffness in series', () => {
    let compliance = 0
    for (let i = 0; i < spec.segments.length; i++) compliance += 1 / segmentStiffness(spec, i)
    expect(1 / compliance).toBeCloseTo(spec.totalStiffness, 10)
  })

  it('assembles symmetric matrices', () => {
    const m = assembleChain(spec)
    expect(m.Kff.asymmetry()).toBeLessThan(1e-12)
    expect(m.Cff.asymmetry()).toBeLessThan(1e-12)
  })
})

describe('damping is a parallel dashpot, not Rayleigh', () => {
  it('gives C the same connectivity pattern as K, not a blend of M and K', () => {
    const spec = base()
    const m = assembleChain(spec)
    // For a uniform chain C is proportional to K entry by entry, with the ratio
    // c/k. Rayleigh damping would add a multiple of M and break this on the
    // diagonal specifically.
    const ratio = segmentDamping(spec, 0) / segmentStiffness(spec, 0)
    for (let i = 0; i < m.dof; i++) {
      for (let j = 0; j < m.dof; j++) {
        expect(m.Cff.get(i, j)).toBeCloseTo(ratio * m.Kff.get(i, j), 12)
      }
    }
  })
})

describe('rebuildStiffnessInPlace matches assembleChain', () => {
  it('agrees exactly with no modulation', () => {
    const spec = unevenChain()
    const reference = assembleChain(spec)
    const target = assembleChain(spec)
    target.Kff.fill(NaN)
    target.Kfd.fill(NaN)
    rebuildStiffnessInPlace(spec, target, undefined)
    expect(target.Kff.toRows()).toEqual(reference.Kff.toRows())
    expect(target.Kfd.toRows()).toEqual(reference.Kfd.toRows())
  })

  it('agrees exactly under an arbitrary per-segment scale', () => {
    const spec = unevenChain()
    const scale = Float64Array.from([0.4, 1.9, 1.0, 0.05, 3.2])
    const reference = assembleChain(spec, scale)
    const target = assembleChain(spec)
    rebuildStiffnessInPlace(spec, target, scale)
    expect(target.Kff.toRows()).toEqual(reference.Kff.toRows())
    expect(target.Kfd.toRows()).toEqual(reference.Kfd.toRows())
    expect(Array.from(target.effectiveStiffness)).toEqual(
      Array.from(reference.effectiveStiffness),
    )
  })

  it('agrees when an interior node is driven, so both blocks are exercised', () => {
    const spec = uniformChain({
      nodeCount: 7,
      length: 1,
      totalStiffness: 100,
      totalDamping: 1,
      mass: 0.05,
      drivenNodes: [0, 3, 6],
    })
    const scale = Float64Array.from([1.5, 0.7, 2.2, 0.9, 1.1, 0.3])
    const reference = assembleChain(spec, scale)
    const target = assembleChain(spec)
    rebuildStiffnessInPlace(spec, target, scale)
    expect(target.Kff.toRows()).toEqual(reference.Kff.toRows())
    expect(target.Kfd.toRows()).toEqual(reference.Kfd.toRows())
  })
})

describe('stiffnessScaleAt', () => {
  it('reports undefined when nothing modulates, keeping the constant-K regime', () => {
    expect(stiffnessScaleAt(base(), 1.234)).toBeUndefined()
  })

  it('reports a scale once a segment modulates', () => {
    const spec = base()
    const segments = spec.segments.map((s, i) =>
      i === 2 ? { ...s, stiffnessModulation: sine(0.5, 10) } : s,
    )
    const scale = stiffnessScaleAt({ ...spec, segments }, 1 / 40)
    expect(scale).toBeDefined()
    // sin(2*pi*10/40) = sin(pi/2) = 1, so k -> k * 1.5 on that segment only.
    expect(scale?.[2]).toBeCloseTo(1.5, 12)
    expect(scale?.[0]).toBe(1)
  })

  it('never lets a segment reach zero or negative stiffness', () => {
    const spec = base()
    const segments = spec.segments.map((s, i) =>
      i === 0 ? { ...s, stiffnessModulation: sine(5, 10) } : s,
    )
    const scale = stiffnessScaleAt({ ...spec, segments }, 3 / 40)
    expect(scale?.[0]).toBeGreaterThan(0)
  })
})
