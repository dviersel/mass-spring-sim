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
