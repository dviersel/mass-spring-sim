/**
 * Immutable edits to a chain specification.
 *
 * Everything is adjustable while the simulation runs, so edits produce a new
 * spec that the caller hands to `Simulation.setChain`, which carries node state
 * across. Keeping these pure keeps the live-editing path testable without a UI.
 */

import type { ChainNode, ChainSegment, ChainSpec } from './chain'
import type { SignalSpec } from './signal'
import { OFF } from './signal'

export function updateNode(
  spec: ChainSpec,
  index: number,
  patch: Partial<ChainNode>,
): ChainSpec {
  return { ...spec, nodes: spec.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)) }
}

export function updateSegment(
  spec: ChainSpec,
  index: number,
  patch: Partial<ChainSegment>,
): ChainSpec {
  return {
    ...spec,
    segments: spec.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
  }
}

/**
 * Make a node driven or free.
 *
 * Freeing a node clears the motion signal, since a free node's position is an
 * unknown and a leftover signal would be invisible but still editable. Driving
 * a node defaults it to held still rather than to whatever it last had.
 */
export function setNodeDriven(spec: ChainSpec, index: number, driven: boolean): ChainSpec {
  return updateNode(spec, index, driven ? { driven: true, motion: OFF } : { driven: false, motion: OFF })
}

export function setNodeMotion(spec: ChainSpec, index: number, motion: SignalSpec): ChainSpec {
  return updateNode(spec, index, { motion })
}

export function setNodeForce(spec: ChainSpec, index: number, force: SignalSpec): ChainSpec {
  return updateNode(spec, index, { force })
}

export function setSegmentActuator(
  spec: ChainSpec,
  index: number,
  actuator: SignalSpec,
): ChainSpec {
  return updateSegment(spec, index, { actuator })
}

export function setSegmentStiffnessModulation(
  spec: ChainSpec,
  index: number,
  stiffnessModulation: SignalSpec,
): ChainSpec {
  return updateSegment(spec, index, { stiffnessModulation })
}

export function setTotals(
  spec: ChainSpec,
  totals: { totalStiffness?: number; totalDamping?: number },
): ChainSpec {
  return {
    ...spec,
    totalStiffness: totals.totalStiffness ?? spec.totalStiffness,
    totalDamping: totals.totalDamping ?? spec.totalDamping,
  }
}

export function setNodeMass(spec: ChainSpec, index: number, mass: number): ChainSpec {
  return updateNode(spec, index, { mass })
}

/** Silence every excitation, leaving the chain's physical properties alone. */
export function silenceExcitations(spec: ChainSpec): ChainSpec {
  return {
    ...spec,
    nodes: spec.nodes.map((n) => ({ ...n, motion: OFF, force: OFF })),
    segments: spec.segments.map((s) => ({ ...s, actuator: OFF, stiffnessModulation: OFF })),
  }
}

/** Re-space the interior nodes evenly, keeping the ends where they are. */
export function respaceEvenly(spec: ChainSpec): ChainSpec {
  const first = spec.nodes[0]
  const last = spec.nodes[spec.nodes.length - 1]
  if (first === undefined || last === undefined) return spec
  const span = last.position - first.position
  const count = spec.nodes.length - 1
  return {
    ...spec,
    nodes: spec.nodes.map((n, i) => ({ ...n, position: first.position + (span * i) / count })),
  }
}

/**
 * Move one interior node along the chain, keeping its neighbours fixed.
 *
 * Clamped strictly between them: node positions must stay strictly increasing,
 * and a zero-length segment would mean infinite stiffness.
 */
export function moveNode(spec: ChainSpec, index: number, position: number): ChainSpec {
  if (index <= 0 || index >= spec.nodes.length - 1) return spec
  const before = spec.nodes[index - 1]
  const after = spec.nodes[index + 1]
  if (before === undefined || after === undefined) return spec
  const margin = (after.position - before.position) * 0.05
  const clamped = Math.min(after.position - margin, Math.max(before.position + margin, position))
  return updateNode(spec, index, { position: clamped })
}

/**
 * Rebuild the chain with a different number of nodes, spaced evenly.
 *
 * The degree-of-freedom count is derived from the spec, never assumed, so this
 * is an ordinary edit rather than a special case. It also makes the simplest
 * interesting configuration reachable: three nodes, one free mass between two
 * driven ones.
 *
 * End nodes keep their driven state and motion; interior nodes start free,
 * because there is no meaningful correspondence between old and new interior
 * indices when the count changes.
 */
export function resizeChain(spec: ChainSpec, nodeCount: number): ChainSpec {
  const count = Math.max(2, Math.round(nodeCount))
  if (count === spec.nodes.length) return spec

  const first = spec.nodes[0]
  const last = spec.nodes[spec.nodes.length - 1]
  if (first === undefined || last === undefined) return spec
  const span = last.position - first.position

  const nodes: ChainNode[] = []
  for (let i = 0; i < count; i++) {
    const isFirst = i === 0
    const isLast = i === count - 1
    const end = isFirst ? first : last
    nodes.push({
      position: first.position + (span * i) / (count - 1),
      mass: isFirst || isLast ? end.mass : (spec.nodes[1]?.mass ?? end.mass),
      driven: isFirst || isLast ? end.driven : false,
      motion: isFirst || isLast ? end.motion : OFF,
      force: OFF,
    })
  }

  const segments: ChainSegment[] = []
  for (let i = 0; i < count - 1; i++) {
    segments.push({ actuator: OFF, stiffnessModulation: OFF })
  }

  return { ...spec, nodes, segments }
}

/**
 * Switch between the longitudinal and transverse regimes.
 *
 * These are different physics, not different drawings, so the chain's own
 * properties change with them: longitudinal is restored by the spring's
 * stiffness, transverse by its tension.
 *
 * Switching to transverse clears any rest-length actuator. A turnbuckle has no
 * transverse effect -- shortening a segment raises tension rather than pushing
 * its ends sideways -- so leaving one armed would show an active control that
 * silently does nothing.
 */
export function setMotionMode(spec: ChainSpec, motionMode: ChainSpec['motionMode']): ChainSpec {
  if (motionMode === spec.motionMode) return spec
  const segments =
    motionMode === 'transverse'
      ? spec.segments.map((s) => ({ ...s, actuator: OFF }))
      : spec.segments
  return { ...spec, motionMode, segments }
}

export function setTension(spec: ChainSpec, tension: number): ChainSpec {
  return { ...spec, tension: Math.max(0, tension) }
}
