/**
 * The chain domain model, in strict SI units.
 *
 * A chain is a list of nodes at arc-length positions along one continuous
 * spring, and the segments between consecutive nodes. There are always
 * `nodes.length - 1` segments.
 *
 * Two invariants carry most of the physics:
 *
 *  - Free versus driven is a property of a NODE, not of the boundary. Nodes 0
 *    and the last node are not special; they are just nodes that usually happen
 *    to be driven. A shaker on an interior mass is the same mechanism at a
 *    different index. The number of degrees of freedom therefore follows from
 *    the spec and is never a constant.
 *
 *  - Segments are pieces of ONE spring, not independent springs, so segment
 *    stiffness scales inversely with segment length. Damping follows the same
 *    law, treating the dashpot as distributed viscoelasticity in that same
 *    continuous spring.
 */

import { type SignalSpec, OFF, isSilent } from './signal'

export interface ChainNode {
  /** Arc-length position along the undeformed spring, metres. Strictly increasing. */
  readonly position: number
  /** Lumped mass, kg. Must be positive when the node is free. */
  readonly mass: number
  /** Driven nodes follow `motion`; free nodes are unknowns of the system. */
  readonly driven: boolean
  /** Prescribed longitudinal displacement, metres. Read only when `driven`. */
  readonly motion: SignalSpec
  /**
   * External force applied at this node, newtons.
   *
   * Only meaningful on a FREE node. A driven node's motion is prescribed, so
   * whatever is imposing that motion absorbs any force applied there and the
   * chain never feels it. The UI surfaces this rather than letting a force
   * silently do nothing.
   */
  readonly force: SignalSpec
}

export interface ChainSegment {
  /** Replaces the length-scaled stiffness when set, N/m. */
  readonly stiffnessOverride?: number | undefined
  /** Replaces the length-scaled damping when set, N.s/m. */
  readonly dampingOverride?: number | undefined
  /** Commanded change in this segment's rest length, metres. Turnbuckle stroke. */
  readonly actuator: SignalSpec
  /** Dimensionless stiffness modulation: k becomes k * (1 + signal). */
  readonly stiffnessModulation: SignalSpec
}

export interface ChainSpec {
  readonly nodes: readonly ChainNode[]
  /** Exactly `nodes.length - 1` entries. */
  readonly segments: readonly ChainSegment[]
  /** Stiffness of the whole spring measured end to end, N/m. */
  readonly totalStiffness: number
  /** Damping of the whole spring measured end to end, N.s/m. */
  readonly totalDamping: number
}

export function segmentCount(spec: ChainSpec): number {
  return spec.nodes.length - 1
}

function nodeAt(spec: ChainSpec, i: number): ChainNode {
  const node = spec.nodes[i]
  if (node === undefined) throw new RangeError(`node index ${i} out of range`)
  return node
}

function segmentAt(spec: ChainSpec, i: number): ChainSegment {
  const segment = spec.segments[i]
  if (segment === undefined) throw new RangeError(`segment index ${i} out of range`)
  return segment
}

export { nodeAt, segmentAt }

/** End-to-end length of the undeformed spring, metres. */
export function totalLength(spec: ChainSpec): number {
  const first = nodeAt(spec, 0)
  const last = nodeAt(spec, spec.nodes.length - 1)
  return last.position - first.position
}

export function segmentLength(spec: ChainSpec, i: number): number {
  return nodeAt(spec, i + 1).position - nodeAt(spec, i).position
}

/**
 * Nominal segment stiffness, N/m: k = k_total * L_total / L_segment.
 *
 * Springs in series satisfy 1/k_total = sum(1/k_i), and this law reproduces
 * that exactly for any spacing, equal or not. "Nominal" means before any
 * time-varying stiffness modulation is applied.
 */
export function segmentStiffness(spec: ChainSpec, i: number): number {
  const override = segmentAt(spec, i).stiffnessOverride
  if (override !== undefined) return override
  return (spec.totalStiffness * totalLength(spec)) / segmentLength(spec, i)
}

/** Nominal segment damping, N.s/m, under the same inverse-length law. */
export function segmentDamping(spec: ChainSpec, i: number): number {
  const override = segmentAt(spec, i).dampingOverride
  if (override !== undefined) return override
  return (spec.totalDamping * totalLength(spec)) / segmentLength(spec, i)
}

/** Node indices that are unknowns of the system, ascending. Length is the DOF count. */
export function freeNodeIndices(spec: ChainSpec): number[] {
  const out: number[] = []
  for (let i = 0; i < spec.nodes.length; i++) {
    if (!nodeAt(spec, i).driven) out.push(i)
  }
  return out
}

/** Node indices whose motion is prescribed, ascending. */
export function drivenNodeIndices(spec: ChainSpec): number[] {
  const out: number[] = []
  for (let i = 0; i < spec.nodes.length; i++) {
    if (nodeAt(spec, i).driven) out.push(i)
  }
  return out
}

/** Number of degrees of freedom. Derived, never assumed. */
export function degreesOfFreedom(spec: ChainSpec): number {
  return freeNodeIndices(spec).length
}

/**
 * True when any segment modulates its stiffness over time.
 *
 * This is the one excitation that cannot live purely in the force vector: it
 * changes K itself, which invalidates modal analysis. Callers use this to
 * switch regime explicitly rather than silently mixing the two.
 */
export function hasTimeVaryingStiffness(spec: ChainSpec): boolean {
  return spec.segments.some((s) => !isSilent(s.stiffnessModulation))
}

export function validateChain(spec: ChainSpec): string[] {
  const problems: string[] = []

  if (spec.nodes.length < 2) {
    problems.push('a chain needs at least two nodes')
    return problems
  }
  if (spec.segments.length !== spec.nodes.length - 1) {
    problems.push(
      `expected ${spec.nodes.length - 1} segments for ${spec.nodes.length} nodes, got ${spec.segments.length}`,
    )
  }
  if (!(spec.totalStiffness > 0)) problems.push('totalStiffness must be positive')
  if (spec.totalDamping < 0) problems.push('totalDamping must not be negative')

  for (let i = 0; i < spec.nodes.length - 1; i++) {
    if (!(nodeAt(spec, i + 1).position > nodeAt(spec, i).position)) {
      problems.push(`node positions must strictly increase (node ${i + 1} is not beyond node ${i})`)
    }
  }
  for (let i = 0; i < spec.nodes.length; i++) {
    const node = nodeAt(spec, i)
    if (!node.driven && !(node.mass > 0)) {
      problems.push(`free node ${i} must have positive mass`)
    }
  }
  return problems
}

export function assertValidChain(spec: ChainSpec): void {
  const problems = validateChain(spec)
  if (problems.length > 0) {
    throw new Error(`invalid chain specification:\n  - ${problems.join('\n  - ')}`)
  }
}

export function quietSegment(): ChainSegment {
  return { actuator: OFF, stiffnessModulation: OFF }
}

export interface UniformChainOptions {
  /** Total number of nodes, including any driven ones. Segments = nodeCount - 1. */
  readonly nodeCount: number
  /** End-to-end length of the spring, metres. */
  readonly length: number
  /** Stiffness of the whole spring end to end, N/m. */
  readonly totalStiffness: number
  /** Damping of the whole spring end to end, N.s/m. */
  readonly totalDamping: number
  /** Lumped mass at every node, kg. */
  readonly mass: number
  /** Node indices to drive. Defaults to both ends. */
  readonly drivenNodes?: readonly number[] | undefined
  /** Prescribed motion applied to every driven node. Defaults to held still. */
  readonly motion?: SignalSpec | undefined
}

/** An equally spaced chain. The starting point for both analytical tests. */
export function uniformChain(options: UniformChainOptions): ChainSpec {
  const { nodeCount, length, totalStiffness, totalDamping, mass } = options
  const driven = new Set(options.drivenNodes ?? [0, nodeCount - 1])
  const motion = options.motion ?? OFF

  const nodes: ChainNode[] = []
  for (let i = 0; i < nodeCount; i++) {
    const isDriven = driven.has(i)
    nodes.push({
      position: (length * i) / (nodeCount - 1),
      mass,
      driven: isDriven,
      motion: isDriven ? motion : OFF,
      force: OFF,
    })
  }

  const segments: ChainSegment[] = []
  for (let i = 0; i < nodeCount - 1; i++) segments.push(quietSegment())

  return { nodes, segments, totalStiffness, totalDamping }
}
