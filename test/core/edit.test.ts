import { describe, expect, it } from 'vitest'
import { uniformChain, type ChainSpec } from '../../src/core/chain'
import { resizeChain, setNodeMass } from '../../src/core/edit'
import { sine } from '../../src/core/signal'

const BASE_MASS = 0.05
const DEFECT_MASS = 0.5

const chain = (nodeCount: number): ChainSpec =>
  uniformChain({
    nodeCount,
    length: 1,
    totalStiffness: 100,
    totalDamping: 0.09,
    mass: BASE_MASS,
    drivenNodes: [0, nodeCount - 1],
  })

const masses = (spec: ChainSpec): number[] => spec.nodes.map((n) => n.mass)

/** Indices whose mass is the defect rather than the base. */
const heavy = (spec: ChainSpec): number[] =>
  spec.nodes.flatMap((n, i) => (n.mass === DEFECT_MASS ? [i] : []))

const withOverride = (spec: ChainSpec, segment: number, stiffness: number): ChainSpec => ({
  ...spec,
  segments: spec.segments.map((s, i) => (i === segment ? { ...s, stiffnessOverride: stiffness } : s)),
})

describe('resizeChain', () => {
  it('leaves a uniform chain uniform, growing or shrinking', () => {
    // The overwhelmingly common case, and the one the dispersion-relation
    // tests depend on: resampling must be exact here, not merely close.
    for (const count of [3, 5, 21, 40]) {
      expect(masses(resizeChain(chain(11), count))).toEqual(Array(count).fill(BASE_MASS))
    }
  })

  it('does not let one heavy node infect the whole chain', () => {
    // The bug this test exists for: every interior node used to be rebuilt as
    // node 1's mass, so making node 1 heavy made the entire chain heavy.
    const spec = setNodeMass(chain(11), 1, DEFECT_MASS)
    const resized = resizeChain(spec, 21)

    expect(heavy(resized).length).toBeLessThanOrEqual(2)
    expect(resized.nodes.filter((n) => n.mass === BASE_MASS).length).toBeGreaterThan(15)
  })

  it('keeps a mass defect where it was put, in arc length', () => {
    // 5 nodes at 0, .25, .5, .75, 1 -> 9 nodes at 0, .125, ... The defect sits
    // at .5; the new node at .5 takes it, and so does the one at .625, which is
    // exactly equidistant from the old .5 and .75. Growth can widen a defect by
    // one node -- that is inherent to resampling, not a bug to round away.
    const spec = setNodeMass(chain(5), 2, DEFECT_MASS)
    const resized = resizeChain(spec, 9)

    expect(heavy(resized)).toEqual([4, 5])
    for (const i of [0, 1, 2, 3, 6, 7, 8]) {
      expect(resized.nodes[i]?.mass).toBe(BASE_MASS)
    }
  })

  it('can drop a defect entirely when shrinking past it', () => {
    // Honest about the other edge: 5 -> 4 lands no new node near .5, so the
    // defect is gone. Nearest-neighbour cannot preserve what it does not sample,
    // and pretending otherwise would smear the defect across nodes that never
    // had it.
    const spec = setNodeMass(chain(5), 2, DEFECT_MASS)
    expect(heavy(resizeChain(spec, 4))).toEqual([])
  })

  it('resamples segment stiffness and damping overrides rather than discarding them', () => {
    // Same silent wipe as the mass bug: a non-proportional damping setup used to
    // vanish the moment the node count changed.
    const spec = withOverride(chain(5), 0, 999)
    const resized = resizeChain(spec, 9)

    const overridden = resized.segments.flatMap((s, i) => (s.stiffnessOverride === 999 ? [i] : []))
    expect(overridden.length).toBeGreaterThan(0)
    // Segment 0 of five nodes spans 0 -> .25, midpoint .125, which is in the
    // first half of the chain; the override must not migrate to the far end.
    for (const i of overridden) expect(i).toBeLessThan(resized.segments.length / 2)
  })

  it('does not fabricate overrides on a chain that had none', () => {
    const resized = resizeChain(chain(11), 6)
    for (const segment of resized.segments) {
      expect(segment.stiffnessOverride).toBeUndefined()
      expect(segment.dampingOverride).toBeUndefined()
    }
  })

  it('still resets excitation, which has no meaningful correspondence', () => {
    // Deliberate and unchanged: material properties resample by position, but
    // excitation does not. Guarding it so the fix above cannot quietly widen.
    const spec: ChainSpec = {
      ...setNodeMass(chain(5), 2, DEFECT_MASS),
      nodes: chain(5).nodes.map((n, i) => (i === 2 ? { ...n, force: sine(1, 10) } : n)),
      segments: chain(5).segments.map((s, i) => (i === 1 ? { ...s, actuator: sine(1e-3, 5) } : s)),
    }
    const resized = resizeChain(spec, 9)

    for (const node of resized.nodes) expect(node.force.kind).toBe('off')
    for (const segment of resized.segments) {
      expect(segment.actuator.kind).toBe('off')
      expect(segment.stiffnessModulation.kind).toBe('off')
    }
    // Ends keep their prescribed motion; interior nodes start free.
    expect(resized.nodes[0]?.driven).toBe(true)
    expect(resized.nodes[resized.nodes.length - 1]?.driven).toBe(true)
    for (let i = 1; i < resized.nodes.length - 1; i++) {
      expect(resized.nodes[i]?.driven).toBe(false)
    }
  })
})
