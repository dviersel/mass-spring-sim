/**
 * Force vector assembly.
 *
 * Every excitation the system supports arrives here and nowhere else:
 *
 *   F_eff = F_external + F_actuator - Kfd.u(t) - Cfd.udot(t)
 *
 * The last two terms are prescribed motion. Kfd.u is the spring pulling on the
 * free nodes because a driven neighbour has moved; Cfd.udot is the dashpot
 * doing the same because that neighbour is moving. The dashpot term is exactly
 * why a driving signal must carry its analytical derivative -- a finite
 * difference would need a second evaluation and would be wrong at the
 * intermediate times RK4 asks about.
 */

import type { Vec } from './linalg'
import { Vec as VecImpl } from './linalg'
import type { ChainMatrices } from './assemble'
import { type ChainSpec, actuatorsApply, nodeAt, segmentAt, segmentCount } from './chain'
import { evaluateSignal, isSilent } from './signal'

export interface ForceScratch {
  readonly u: Vec
  readonly uDot: Vec
}

export function createForceScratch(matrices: ChainMatrices): ForceScratch {
  const nDriven = matrices.drivenIndices.length
  return { u: VecImpl.zeros(nDriven), uDot: VecImpl.zeros(nDriven) }
}

export function assembleForceVector(
  spec: ChainSpec,
  matrices: ChainMatrices,
  t: number,
  scratch: ForceScratch,
  out: Vec,
): void {
  const { dof, freeIndices, drivenIndices, dofOfNode, Kfd, Cfd } = matrices
  out.fill(0)

  // External forces. Only free nodes can feel one: a driven node's motion is
  // prescribed, so whatever imposes that motion silently absorbs any force
  // applied there.
  for (let a = 0; a < dof; a++) {
    const node = nodeAt(spec, freeIndices[a] as number)
    if (isSilent(node.force)) continue
    out.add(a, evaluateSignal(node.force, t).value)
  }

  // Actuators. A segment whose rest length is commanded to delta(t) develops
  // both a spring force k.delta and a dashpot force c.deltadot, and pushes its
  // two end nodes apart. Stiffness and damping come from the matrices rather
  // than being recomputed, so these terms cannot drift out of step with K and C
  // when stiffness is time-varying.
  //
  // Only in the longitudinal regime: a rest-length change acts along the
  // segment's own axis, which transversely is not a displacement at all.
  const nSeg = segmentCount(spec)
  for (let i = 0; actuatorsApply(spec) && i < nSeg; i++) {
    const actuator = segmentAt(spec, i).actuator
    if (isSilent(actuator)) continue

    const { value: delta, derivative: deltaDot } = evaluateSignal(actuator, t)
    const force =
      (matrices.effectiveStiffness[i] as number) * delta +
      (matrices.effectiveDamping[i] as number) * deltaDot

    const lower = dofOfNode[i] as number
    const upper = dofOfNode[i + 1] as number
    if (lower >= 0) out.add(lower, -force)
    if (upper >= 0) out.add(upper, force)
  }

  // Prescribed motion of driven nodes, entering through the coupling blocks.
  const nDriven = drivenIndices.length
  if (nDriven === 0) return

  let anyMotion = false
  for (let b = 0; b < nDriven; b++) {
    const node = nodeAt(spec, drivenIndices[b] as number)
    if (isSilent(node.motion)) {
      scratch.u.set(b, 0)
      scratch.uDot.set(b, 0)
      continue
    }
    const sample = evaluateSignal(node.motion, t)
    scratch.u.set(b, sample.value)
    scratch.uDot.set(b, sample.derivative)
    anyMotion = true
  }
  if (!anyMotion) return

  for (let a = 0; a < dof; a++) {
    let coupling = 0
    for (let b = 0; b < nDriven; b++) {
      coupling += Kfd.get(a, b) * scratch.u.get(b) + Cfd.get(a, b) * scratch.uDot.get(b)
    }
    out.add(a, -coupling)
  }
}

/** Prescribed displacement of a driven node at time t, metres. */
export function prescribedDisplacement(spec: ChainSpec, nodeIndex: number, t: number): number {
  return evaluateSignal(nodeAt(spec, nodeIndex).motion, t).value
}

/** Prescribed velocity of a driven node at time t, m/s. Analytical, never differenced. */
export function prescribedVelocity(spec: ChainSpec, nodeIndex: number, t: number): number {
  return evaluateSignal(nodeAt(spec, nodeIndex).motion, t).derivative
}
