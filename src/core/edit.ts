/**
 * Immutable edits to a chain specification.
 *
 * Everything is adjustable while the simulation runs, so edits produce a new
 * spec that the caller hands to `Simulation.setChain`, which carries node state
 * across. Keeping these pure keeps the live-editing path testable without a UI.
 */

import { totalLength, type ChainNode, type ChainSegment, type ChainSpec } from './chain'
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
/** Tie one node to ground by a spring, N/m. Zero removes the tether. */
export function setNodeGroundStiffness(
  spec: ChainSpec,
  index: number,
  groundStiffness: number,
): ChainSpec {
  return updateNode(spec, index, { groundStiffness })
}

/** Tie one node to ground by a dashpot, N.s/m. Zero removes it. */
export function setNodeGroundDamping(
  spec: ChainSpec,
  index: number,
  groundDamping: number,
): ChainSpec {
  return updateNode(spec, index, { groundDamping })
}

/**
 * Tether every node to ground with the same spring.
 *
 * The cutoff frequency is a property of the lattice, not of one node: it comes
 * from every site being pulled back, so setting them one at a time is not a
 * thing anyone wants to do by hand.
 */
export function tetherAll(spec: ChainSpec, groundStiffness: number): ChainSpec {
  return { ...spec, nodes: spec.nodes.map((node) => ({ ...node, groundStiffness })) }
}

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
 * Index of the entry in `positions` nearest to `p`, ties going to the lower
 * index. Only exact ties are affected, which happens when a new node lands
 * precisely between two old ones.
 */
function nearestIndex(positions: readonly number[], p: number): number {
  let best = 0
  let bestDistance = Infinity
  for (const [i, position] of positions.entries()) {
    const distance = Math.abs(position - p)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/**
 * Rebuild the chain with a different number of nodes, spaced evenly.
 *
 * The degree-of-freedom count is derived from the spec, never assumed, so this
 * is an ordinary edit rather than a special case. It also makes the simplest
 * interesting configuration reachable: three nodes, one free mass between two
 * driven ones.
 *
 * Material properties -- nodal mass, and the per-segment stiffness and damping
 * overrides -- resample from the nearest old node or segment by ARC LENGTH.
 * Index correspondence is meaningless once the count changes, but position is
 * not, so a mass defect stays where it was put instead of being flattened away.
 * Growth can widen a defect onto a node that ties for nearest, and shrinking
 * past one drops it; both follow from resampling a lumped quantity and are
 * preferable to interpolating, which would smear a defect across nodes that
 * never carried it.
 *
 * Excitation does NOT resample. End nodes keep their driven state and motion;
 * interior nodes start free, and every force, actuator and stiffness modulation
 * resets. A prescribed motion belongs to one node in one arrangement, and
 * moving it to a node the user did not choose is worse than clearing it.
 */
export function resizeChain(spec: ChainSpec, nodeCount: number): ChainSpec {
  const count = Math.max(2, Math.round(nodeCount))
  if (count === spec.nodes.length) return spec

  const first = spec.nodes[0]
  const last = spec.nodes[spec.nodes.length - 1]
  if (first === undefined || last === undefined) return spec
  const span = last.position - first.position
  const positionAt = (i: number): number => first.position + (span * i) / (count - 1)

  const nodePositions = spec.nodes.map((node) => node.position)
  // A segment is resampled on its midpoint, being the thing that has a position.
  const segmentMidpoints = spec.segments.map((_, i) => {
    const a = spec.nodes[i]
    const b = spec.nodes[i + 1]
    return a !== undefined && b !== undefined ? (a.position + b.position) / 2 : first.position
  })

  const nodes: ChainNode[] = []
  for (let i = 0; i < count; i++) {
    const isFirst = i === 0
    const isLast = i === count - 1
    const end = isFirst ? first : last
    const position = positionAt(i)
    const source = spec.nodes[nearestIndex(nodePositions, position)]
    nodes.push({
      position,
      mass: source?.mass ?? end.mass,
      driven: isFirst || isLast ? end.driven : false,
      motion: isFirst || isLast ? end.motion : OFF,
      force: OFF,
      // Tethers are material properties of a node, so they resample with the
      // mass rather than being dropped.
      groundStiffness: source?.groundStiffness,
      groundDamping: source?.groundDamping,
    })
  }

  const segments: ChainSegment[] = []
  for (let i = 0; i < count - 1; i++) {
    const midpoint = (positionAt(i) + positionAt(i + 1)) / 2
    const source = spec.segments[nearestIndex(segmentMidpoints, midpoint)]
    segments.push({
      actuator: OFF,
      stiffnessModulation: OFF,
      stiffnessOverride: source?.stiffnessOverride,
      dampingOverride: source?.dampingOverride,
    })
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

  // Each regime is restored by a quantity the other does not use, and a chain
  // built for one carries nothing for the other. Zero tension transversely is
  // not a string that hangs quietly -- it is a system with no restoring force
  // at all, which the validator rejects outright.
  //
  // So seed the missing quantity with the value that reproduces the spectrum
  // the chain already had: T = k_total.L_total makes T/L equal
  // k_total.L_total/L segment for segment. Switching regimes then changes the
  // mechanism and not the pitch, which is both a safe default and the more
  // interesting comparison.
  const length = totalLength(spec)
  const tension =
    spec.tension > 0 ? spec.tension : spec.totalStiffness * length
  const totalStiffness =
    spec.totalStiffness > 0 ? spec.totalStiffness : length > 0 ? spec.tension / length : 1

  return { ...spec, motionMode, tension, totalStiffness, segments }
}

export function setTension(spec: ChainSpec, tension: number): ChainSpec {
  return { ...spec, tension: Math.max(0, tension) }
}
