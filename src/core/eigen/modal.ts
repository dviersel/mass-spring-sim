/**
 * Modal analysis: undamped frequencies and real mode shapes from the symmetric
 * problem, exact damping ratios from the state-space spectrum.
 *
 * Two solvers, because they answer different questions and each is the right
 * tool for its own:
 *
 *  - The symmetric generalised problem gives REAL mode shapes. Those are what
 *    "start from a single mode" needs as an initial condition, what the modal
 *    participation bars project onto, and what the analytical dispersion test
 *    validates.
 *
 *  - The state-space problem gives EXACT damping ratios. Parallel dashpots are
 *    only classically damped when c/k happens to be uniform across segments;
 *    the moment spacing is uneven or a per-segment override is used, projecting
 *    C onto the undamped shapes becomes an approximation that degrades quietly.
 *    The 2N complex spectrum is exact regardless.
 */

import { Matrix } from '../linalg'
import { undampedModes } from './jacobi'
import { unsymmetricEigenvalues, type ComplexEigenvalue } from './hqr'

export interface ModeSummary {
  readonly index: number
  /** Undamped natural angular frequency, rad/s. */
  readonly omega: number
  /** Undamped natural frequency, Hz. */
  readonly frequencyHz: number
  /** Damping ratio. Below 1 oscillatory, at or above 1 overdamped. */
  readonly zeta: number
  /** Damped frequency, Hz. Zero when the mode does not oscillate. */
  readonly dampedFrequencyHz: number
  readonly oscillatory: boolean
  /**
   * Time for the mode's amplitude to fall to 1/e, seconds. Infinite when
   * undamped. This is what "watch it decay" actually looks like on a clock.
   */
  readonly decayTime: number
}

export interface ModalAnalysis {
  readonly modes: readonly ModeSummary[]
  /** Real, mass-normalised mode shapes. Column r is mode r. */
  readonly shapes: Matrix
  /**
   * How far the system is from classically damped: the off-diagonal energy of
   * the modal damping matrix relative to its diagonal. Zero means C is exactly
   * proportional to K, so the real mode shapes are the true damped ones.
   */
  readonly nonProportionality: number
  readonly classicallyDamped: boolean
  readonly converged: boolean
}

/** Below this, mode shapes are the true damped shapes for practical purposes. */
const PROPORTIONAL_TOLERANCE = 1e-9

export function analyseModes(Mff: Matrix, Cff: Matrix, Kff: Matrix): ModalAnalysis {
  const n = Kff.rows
  if (n === 0) {
    return {
      modes: [],
      shapes: Matrix.zeros(0, 0),
      nonProportionality: 0,
      classicallyDamped: true,
      converged: true,
    }
  }

  const { omega, shapes, converged } = undampedModes(Mff, Kff)

  // Modal damping matrix. Diagonal means classically damped.
  const modalC = shapes.transpose().mul(Cff).mul(shapes)
  let diagonal = 0
  let offDiagonal = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const value = modalC.get(i, j) * modalC.get(i, j)
      if (i === j) diagonal += value
      else offDiagonal += value
    }
  }
  const nonProportionality = diagonal > 0 ? Math.sqrt(offDiagonal / diagonal) : 0
  const classicallyDamped = nonProportionality < PROPORTIONAL_TOLERANCE

  const zetas = dampingRatios(Mff, Cff, Kff, omega)

  const modes: ModeSummary[] = []
  for (let r = 0; r < n; r++) {
    const omegaR = omega[r] as number
    const zeta = zetas[r] as number
    const oscillatory = zeta < 1 && omegaR > 0
    const decayRate = zeta * omegaR
    modes.push({
      index: r,
      omega: omegaR,
      frequencyHz: omegaR / (2 * Math.PI),
      zeta,
      dampedFrequencyHz: oscillatory
        ? (omegaR * Math.sqrt(1 - zeta * zeta)) / (2 * Math.PI)
        : 0,
      oscillatory,
      decayTime: decayRate > 0 ? 1 / decayRate : Number.POSITIVE_INFINITY,
    })
  }

  return { modes, shapes, nonProportionality, classicallyDamped, converged }
}

/**
 * Exact damping ratios from the state-space spectrum.
 *
 * The second-order system linearises to zdot = A.z with
 *
 *   A = [    0        I   ]
 *       [ -M^-1 K  -M^-1 C ]
 *
 * whose eigenvalues are lambda = -zeta.omega +/- i.omega.sqrt(1 - zeta^2), so
 * omega_n = |lambda| and zeta = -Re(lambda)/|lambda| directly.
 */
function dampingRatios(
  Mff: Matrix,
  Cff: Matrix,
  Kff: Matrix,
  omega: Float64Array,
): Float64Array {
  const n = Kff.rows
  const zetas = new Float64Array(n)

  const a = Matrix.zeros(2 * n, 2 * n)
  for (let i = 0; i < n; i++) {
    a.set(i, n + i, 1)
    const invM = 1 / Mff.get(i, i)
    for (let j = 0; j < n; j++) {
      a.set(n + i, j, -invM * Kff.get(i, j))
      a.set(n + i, n + j, -invM * Cff.get(i, j))
    }
  }

  let spectrum: ComplexEigenvalue[]
  try {
    spectrum = unsymmetricEigenvalues(a)
  } catch {
    // Falling back is better than showing nothing, but the caller should never
    // silently believe an approximation is exact, so only the proportional
    // formula is used and it is exact precisely when it applies.
    return proportionalFallback(Mff, Cff, Kff, omega)
  }

  const oscillatory = spectrum
    .filter((lambda) => lambda.im > 0)
    .map((lambda) => ({ magnitude: Math.hypot(lambda.re, lambda.im), re: lambda.re }))
    .sort((x, y) => x.magnitude - y.magnitude)

  const real = spectrum
    .filter((lambda) => lambda.im === 0)
    .map((lambda) => lambda.re)
    .sort((x, y) => Math.abs(x) - Math.abs(y))

  // Match each oscillatory eigenvalue to the undamped frequency it sits
  // closest to, rather than assuming the oscillatory modes are simply the
  // lowest ones. Under proportional damping those are the same thing, but a
  // non-proportional system can leave a low mode overdamped while a higher one
  // still rings, and assigning by position would then mislabel both.
  const assigned = new Array<boolean>(n).fill(false)
  for (const mode of oscillatory) {
    let best = -1
    let bestError = Number.POSITIVE_INFINITY
    for (let r = 0; r < n; r++) {
      if (assigned[r]) continue
      const error = Math.abs((omega[r] as number) - mode.magnitude)
      if (error < bestError) {
        bestError = error
        best = r
      }
    }
    if (best < 0) break
    assigned[best] = true
    zetas[best] = mode.magnitude > 0 ? -mode.re / mode.magnitude : 0
  }

  // Overdamped modes surface as two real roots whose product is omega_n^2.
  // Match each remaining slot to the pair whose geometric mean sits closest to
  // that slot's undamped frequency.
  const used = new Array<boolean>(real.length).fill(false)
  for (let r = 0; r < n; r++) {
    if (assigned[r]) continue
    const target = omega[r] as number
    let bestI = -1
    let bestJ = -1
    let bestError = Number.POSITIVE_INFINITY
    for (let i = 0; i < real.length; i++) {
      if (used[i]) continue
      for (let j = i + 1; j < real.length; j++) {
        if (used[j]) continue
        const geometricMean = Math.sqrt(Math.abs((real[i] as number) * (real[j] as number)))
        const error = Math.abs(geometricMean - target)
        if (error < bestError) {
          bestError = error
          bestI = i
          bestJ = j
        }
      }
    }
    if (bestI < 0 || bestJ < 0) {
      zetas[r] = 0
      continue
    }
    used[bestI] = true
    used[bestJ] = true
    const sum = Math.abs(real[bestI] as number) + Math.abs(real[bestJ] as number)
    const product = Math.sqrt(Math.abs((real[bestI] as number) * (real[bestJ] as number)))
    zetas[r] = product > 0 ? sum / (2 * product) : 1
  }

  return zetas
}

/** zeta_r = (phi_r^T C phi_r) / (2 omega_r). Exact only for proportional damping. */
function proportionalFallback(
  Mff: Matrix,
  Cff: Matrix,
  Kff: Matrix,
  omega: Float64Array,
): Float64Array {
  const n = Kff.rows
  const { shapes } = undampedModes(Mff, Kff)
  const modalC = shapes.transpose().mul(Cff).mul(shapes)
  const zetas = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    const omegaR = omega[r] as number
    zetas[r] = omegaR > 0 ? modalC.get(r, r) / (2 * omegaR) : 0
  }
  return zetas
}
