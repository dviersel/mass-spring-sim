/**
 * Cyclic Jacobi eigensolver for real symmetric matrices, and the generalised
 * undamped problem K.phi = omega^2 . M . phi built on top of it.
 *
 * Jacobi is chosen over anything faster because these matrices are tiny (tens
 * of degrees of freedom at most) and because it is the method that delivers
 * eigenvalues of a symmetric matrix to full machine precision. The definition
 * of done for this project is agreement with an analytical dispersion relation
 * to near machine precision, so accuracy is the only property that matters here
 * and asymptotic cost is irrelevant.
 */

import { Matrix, Vec } from '../linalg'

export interface SymmetricEigenResult {
  /** Eigenvalues, ascending. */
  readonly values: Float64Array
  /** Eigenvector k is column k. Orthonormal. */
  readonly vectors: Matrix
  readonly sweeps: number
  readonly converged: boolean
}

const MAX_SWEEPS = 100

/**
 * Eigen-decomposition of a real symmetric matrix.
 *
 * Only the upper triangle is read, so a caller with a matrix that is symmetric
 * up to rounding gets a deterministic answer rather than one that depends on
 * which half happened to be written last.
 */
export function symmetricEigen(input: Matrix): SymmetricEigenResult {
  const n = input.rows
  if (input.cols !== n) throw new Error('symmetricEigen: matrix must be square')

  const a = Matrix.zeros(n, n)
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const v = input.get(i, j)
      a.set(i, j, v)
      a.set(j, i, v)
    }
  }

  const v = Matrix.identity(n)
  let sweeps = 0
  let converged = n <= 1

  // Converged means a whole sweep in which every off-diagonal was already
  // negligible against the diagonals it would modify. Testing for an exactly
  // zero off-diagonal sum would never be satisfied in floating point.
  while (sweeps < MAX_SWEEPS && !converged) {
    let rotations = 0

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a.get(p, q)
        if (apq === 0) continue

        const app = a.get(p, p)
        const aqq = a.get(q, q)

        // Rotating on an entry this small would add rounding noise rather than
        // accuracy, so retire it instead.
        if (Math.abs(apq) <= 0.5 * Number.EPSILON * Math.hypot(app, aqq)) {
          a.set(p, q, 0)
          a.set(q, p, 0)
          continue
        }

        // Numerically stable rotation annihilating a[p][q]; taking the smaller
        // root keeps |t| <= 1 and avoids cancellation.
        const theta = (aqq - app) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        const tau = s / (1 + c)

        a.set(p, p, app - t * apq)
        a.set(q, q, aqq + t * apq)
        a.set(p, q, 0)
        a.set(q, p, 0)

        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue
          const aip = a.get(i, p)
          const aiq = a.get(i, q)
          const nextIp = aip - s * (aiq + tau * aip)
          const nextIq = aiq + s * (aip - tau * aiq)
          a.set(i, p, nextIp)
          a.set(p, i, nextIp)
          a.set(i, q, nextIq)
          a.set(q, i, nextIq)
        }
        for (let i = 0; i < n; i++) {
          const vip = v.get(i, p)
          const viq = v.get(i, q)
          v.set(i, p, vip - s * (viq + tau * vip))
          v.set(i, q, viq + s * (vip - tau * viq))
        }

        rotations++
      }
    }

    sweeps++
    if (rotations === 0) converged = true
  }

  const values = new Float64Array(n)
  for (let i = 0; i < n; i++) values[i] = a.get(i, i)

  return sortAscending(values, v, sweeps, converged)
}

function sortAscending(
  values: Float64Array,
  vectors: Matrix,
  sweeps: number,
  converged: boolean,
): SymmetricEigenResult {
  const n = values.length
  const order = Array.from({ length: n }, (_, i) => i)
  order.sort((x, y) => (values[x] as number) - (values[y] as number))

  const sortedValues = new Float64Array(n)
  const sortedVectors = Matrix.zeros(n, n)
  for (let k = 0; k < n; k++) {
    const src = order[k] as number
    sortedValues[k] = values[src] as number

    // Fix the arbitrary sign of each eigenvector so that repeated solves of the
    // same system produce identical mode shapes -- otherwise a mode would flip
    // polarity on screen for no physical reason.
    let pivot = 0
    let pivotMagnitude = 0
    for (let i = 0; i < n; i++) {
      const magnitude = Math.abs(vectors.get(i, src))
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude
        pivot = i
      }
    }
    const sign = vectors.get(pivot, src) < 0 ? -1 : 1
    for (let i = 0; i < n; i++) sortedVectors.set(i, k, sign * vectors.get(i, src))
  }

  return { values: sortedValues, vectors: sortedVectors, sweeps, converged }
}

export interface UndampedModes {
  /** Undamped natural angular frequencies, rad/s, ascending. */
  readonly omega: Float64Array
  /** Mass-normalised mode shape r is column r: phi^T . M . phi = I. */
  readonly shapes: Matrix
  readonly converged: boolean
}

/**
 * Solve K.phi = omega^2 . M . phi for a diagonal, positive-definite M.
 *
 * With M diagonal the mass-orthogonalising transform S = M^(-1/2) is itself
 * diagonal and exact, so reducing to the standard symmetric problem costs no
 * accuracy at all. Because S A S is solved with orthonormal eigenvectors y, the
 * recovered shapes phi = S.y come out mass-normalised for free.
 */
export function undampedModes(Mff: Matrix, Kff: Matrix): UndampedModes {
  const n = Kff.rows
  if (n === 0) {
    return { omega: new Float64Array(0), shapes: Matrix.zeros(0, 0), converged: true }
  }

  const invSqrtM = Vec.zeros(n)
  for (let i = 0; i < n; i++) {
    const m = Mff.get(i, i)
    if (!(m > 0)) throw new Error(`undampedModes: node ${i} has non-positive mass ${m}`)
    invSqrtM.set(i, 1 / Math.sqrt(m))
  }

  const a = Matrix.zeros(n, n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      a.set(i, j, invSqrtM.get(i) * Kff.get(i, j) * invSqrtM.get(j))
    }
  }

  const { values, vectors, converged } = symmetricEigen(a)

  const omega = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    // Rounding can push a genuinely zero eigenvalue slightly negative; a rigid
    // body mode is a real possibility here (every node free) and must not
    // produce NaN.
    omega[i] = Math.sqrt(Math.max(0, values[i] as number))
  }

  const shapes = Matrix.zeros(n, n)
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < n; i++) shapes.set(i, r, invSqrtM.get(i) * vectors.get(i, r))
  }

  return { omega, shapes, converged }
}
