/**
 * Matrix assembly and partitioning.
 *
 * The global mass, damping and stiffness matrices are built over EVERY node --
 * driven and free alike, one code path -- and only then partitioned into the
 * free block that the integrator advances and the free-driven coupling blocks
 * that turn prescribed motion into a force.
 *
 * Nothing here reads a motion, force or actuator signal. M, C and K depend only
 * on the chain's geometry, masses, stiffnesses and on which nodes are free.
 * Excitation reaches the system exclusively through the force vector.
 *
 * The single exception is time-varying stiffness, which by definition changes
 * K. It is passed in explicitly as `stiffnessScale` so that switching into that
 * regime is a visible act at the call site rather than a hidden coupling.
 */

import { Matrix } from './linalg'
import {
  type ChainSpec,
  nodeAt,
  segmentAt,
  segmentCount,
  segmentDamping,
  segmentStiffness,
} from './chain'
import { evaluateSignal, isSilent } from './signal'

export interface ChainMatrices {
  /** Number of free nodes. Derived from the spec; never assumed. */
  readonly dof: number
  /** Node index for each degree of freedom, ascending. */
  readonly freeIndices: readonly number[]
  /** Node index for each prescribed slot, ascending. */
  readonly drivenIndices: readonly number[]
  /** Degree-of-freedom index for each node, or -1 if the node is driven. */
  readonly dofOfNode: Int32Array
  /** Prescribed-slot index for each node, or -1 if the node is free. */
  readonly slotOfNode: Int32Array

  /** Diagonal lumped mass of the free block, kg. */
  readonly Mff: Matrix
  readonly Cff: Matrix
  readonly Kff: Matrix
  /** Couples prescribed velocities into the free equations, dof x nDriven. */
  readonly Cfd: Matrix
  /** Couples prescribed displacements into the free equations, dof x nDriven. */
  readonly Kfd: Matrix

  /**
   * Effective per-segment stiffness and damping actually used above, including
   * any `stiffnessScale`. Force assembly reads these rather than recomputing,
   * so the actuator terms cannot drift out of step with the matrices.
   */
  readonly effectiveStiffness: Float64Array
  readonly effectiveDamping: Float64Array
}

/**
 * @param stiffnessScale Optional per-segment multiplier on nominal stiffness.
 *   Supplied only when running the time-varying-stiffness regime. Absent means
 *   a constant K, which is the case modal analysis is valid for.
 */
export function assembleChain(
  spec: ChainSpec,
  stiffnessScale?: Float64Array | undefined,
): ChainMatrices {
  const n = spec.nodes.length
  const nSeg = segmentCount(spec)

  const Kg = Matrix.zeros(n, n)
  const Cg = Matrix.zeros(n, n)
  const effectiveStiffness = new Float64Array(nSeg)
  const effectiveDamping = new Float64Array(nSeg)

  for (let i = 0; i < nSeg; i++) {
    const scale = stiffnessScale === undefined ? 1 : (stiffnessScale[i] ?? 1)
    const k = segmentStiffness(spec, i) * scale
    const c = segmentDamping(spec, i)
    effectiveStiffness[i] = k
    effectiveDamping[i] = c

    // A segment connects nodes i and i+1 and resists their relative motion.
    // The dashpot sits in parallel with the spring, so it stamps in with the
    // identical pattern -- not as a multiple of M and K.
    Kg.add(i, i, k)
    Kg.add(i, i + 1, -k)
    Kg.add(i + 1, i, -k)
    Kg.add(i + 1, i + 1, k)

    Cg.add(i, i, c)
    Cg.add(i, i + 1, -c)
    Cg.add(i + 1, i, -c)
    Cg.add(i + 1, i + 1, c)
  }

  const freeIndices: number[] = []
  const drivenIndices: number[] = []
  const dofOfNode = new Int32Array(n).fill(-1)
  const slotOfNode = new Int32Array(n).fill(-1)

  for (let i = 0; i < n; i++) {
    if (nodeAt(spec, i).driven) {
      slotOfNode[i] = drivenIndices.length
      drivenIndices.push(i)
    } else {
      dofOfNode[i] = freeIndices.length
      freeIndices.push(i)
    }
  }

  const dof = freeIndices.length
  const nDriven = drivenIndices.length

  const Mff = Matrix.zeros(dof, dof)
  const Cff = Matrix.zeros(dof, dof)
  const Kff = Matrix.zeros(dof, dof)
  const Cfd = Matrix.zeros(dof, nDriven)
  const Kfd = Matrix.zeros(dof, nDriven)

  for (let a = 0; a < dof; a++) {
    const i = freeIndices[a] as number
    Mff.set(a, a, nodeAt(spec, i).mass)
    for (let b = 0; b < dof; b++) {
      const j = freeIndices[b] as number
      Cff.set(a, b, Cg.get(i, j))
      Kff.set(a, b, Kg.get(i, j))
    }
    for (let b = 0; b < nDriven; b++) {
      const j = drivenIndices[b] as number
      Cfd.set(a, b, Cg.get(i, j))
      Kfd.set(a, b, Kg.get(i, j))
    }
  }

  return {
    dof,
    freeIndices,
    drivenIndices,
    dofOfNode,
    slotOfNode,
    Mff,
    Cff,
    Kff,
    Cfd,
    Kfd,
    effectiveStiffness,
    effectiveDamping,
  }
}

/**
 * Per-segment stiffness multipliers at time t, or undefined when no segment is
 * currently modulating. Returning undefined lets the caller keep its cached
 * constant-K matrices and stay in the regime where modal analysis holds.
 *
 * A modulation signal m(t) scales its segment as k -> k * (1 + m(t)). The
 * multiplier is floored just above zero: a segment cannot be driven to zero or
 * negative stiffness, which would be a non-physical spring that pushes the
 * wrong way and would make the system blow up rather than teach anything.
 */
export function stiffnessScaleAt(spec: ChainSpec, t: number): Float64Array | undefined {
  const nSeg = segmentCount(spec)
  let varying = false
  const scale = new Float64Array(nSeg).fill(1)

  for (let i = 0; i < nSeg; i++) {
    const modulation = segmentAt(spec, i).stiffnessModulation
    if (isSilent(modulation)) continue
    varying = true
    scale[i] = Math.max(MIN_STIFFNESS_SCALE, 1 + evaluateSignal(modulation, t).value)
  }

  return varying ? scale : undefined
}

/** Floor on the stiffness multiplier, keeping every segment a real spring. */
export const MIN_STIFFNESS_SCALE = 1e-3

/**
 * Rebuild only the stiffness blocks in place, for the time-varying regime.
 *
 * K is linear in the segment stiffnesses, so restamping is cheap and needs no
 * allocation -- which matters because this runs at every RK4 stage of every
 * substep. The stamp pattern is the partitioned form of what `assembleChain`
 * does globally; `rebuildStiffnessInPlace matches assembleChain` in the test
 * suite pins the two together.
 *
 * Mass and damping are untouched: modulating a segment's stiffness does not
 * modulate its dashpot.
 */
export function rebuildStiffnessInPlace(
  spec: ChainSpec,
  matrices: ChainMatrices,
  stiffnessScale: Float64Array | undefined,
): void {
  const { Kff, Kfd, dofOfNode, slotOfNode, effectiveStiffness } = matrices
  Kff.fill(0)
  Kfd.fill(0)

  const nSeg = segmentCount(spec)
  for (let i = 0; i < nSeg; i++) {
    const scale = stiffnessScale === undefined ? 1 : (stiffnessScale[i] ?? 1)
    const k = segmentStiffness(spec, i) * scale
    effectiveStiffness[i] = k

    const lowDof = dofOfNode[i] as number
    const highDof = dofOfNode[i + 1] as number
    const lowSlot = slotOfNode[i] as number
    const highSlot = slotOfNode[i + 1] as number

    if (lowDof >= 0) Kff.add(lowDof, lowDof, k)
    if (highDof >= 0) Kff.add(highDof, highDof, k)
    if (lowDof >= 0 && highDof >= 0) {
      Kff.add(lowDof, highDof, -k)
      Kff.add(highDof, lowDof, -k)
    }
    if (lowDof >= 0 && highSlot >= 0) Kfd.add(lowDof, highSlot, -k)
    if (highDof >= 0 && lowSlot >= 0) Kfd.add(highDof, lowSlot, -k)
  }
}
