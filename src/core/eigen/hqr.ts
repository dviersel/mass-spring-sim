/**
 * Eigenvalues of a real, generally unsymmetric matrix: balance, reduce to upper
 * Hessenberg form, then Francis double-shift QR.
 *
 * This exists because dashpots in parallel with springs do not in general give
 * a classically damped system. When C is not proportional to K the damped modes
 * are genuinely complex and their damping ratios cannot be recovered by
 * projecting C onto the undamped mode shapes -- that projection is exact only
 * in the proportional case and degrades silently otherwise. Linearising to the
 * 2N state-space form and taking its complex spectrum is exact for any damping.
 *
 * Only eigenvalues are computed, never eigenvectors, which removes the need to
 * accumulate the transformations.
 *
 * Indices run 1..n throughout, matching the classical EISPACK formulation this
 * follows. The arrays are allocated one larger and slot 0 left unused; that
 * costs nothing at this size and removes a whole class of translation error.
 */

import { Matrix } from '../linalg'

export interface ComplexEigenvalue {
  readonly re: number
  readonly im: number
}

const RADIX = 2
const MAX_ITERATIONS = 60

/**
 * Diagonal similarity scaling to even out row and column norms.
 *
 * Exact in floating point, since every scaling is a power of the radix, so it
 * costs no accuracy and can substantially improve what follows.
 */
function balance(a: Matrix, n: number): void {
  const sqrdx = RADIX * RADIX
  let done = false

  while (!done) {
    done = true
    for (let i = 1; i <= n; i++) {
      let r = 0
      let c = 0
      for (let j = 1; j <= n; j++) {
        if (j === i) continue
        c += Math.abs(a.get(j, i))
        r += Math.abs(a.get(i, j))
      }
      if (c === 0 || r === 0) continue

      let g = r / RADIX
      let f = 1
      const s = c + r
      while (c < g) {
        f *= RADIX
        c *= sqrdx
      }
      g = r * RADIX
      while (c > g) {
        f /= RADIX
        c /= sqrdx
      }
      if ((c + r) / f < 0.95 * s) {
        done = false
        const gi = 1 / f
        for (let j = 1; j <= n; j++) a.set(i, j, a.get(i, j) * gi)
        for (let j = 1; j <= n; j++) a.set(j, i, a.get(j, i) * f)
      }
    }
  }
}

/** Reduction to upper Hessenberg form by elimination with pivoting. */
function hessenberg(a: Matrix, n: number): void {
  for (let m = 2; m < n; m++) {
    let x = 0
    let pivot = m
    for (let j = m; j <= n; j++) {
      if (Math.abs(a.get(j, m - 1)) > Math.abs(x)) {
        x = a.get(j, m - 1)
        pivot = j
      }
    }

    if (pivot !== m) {
      for (let j = m - 1; j <= n; j++) {
        const t = a.get(pivot, j)
        a.set(pivot, j, a.get(m, j))
        a.set(m, j, t)
      }
      for (let j = 1; j <= n; j++) {
        const t = a.get(j, pivot)
        a.set(j, pivot, a.get(j, m))
        a.set(j, m, t)
      }
    }

    if (x === 0) continue
    for (let i = m + 1; i <= n; i++) {
      let y = a.get(i, m - 1)
      if (y === 0) continue
      y /= x
      a.set(i, m - 1, y)
      for (let j = m; j <= n; j++) a.set(i, j, a.get(i, j) - y * a.get(m, j))
      for (let j = 1; j <= n; j++) a.set(j, m, a.get(j, m) + y * a.get(j, i))
    }
  }

  // The elimination leaves its multipliers below the subdiagonal. Clear them so
  // what remains is an actual Hessenberg matrix.
  for (let i = 3; i <= n; i++) {
    for (let j = 1; j <= i - 2; j++) a.set(i, j, 0)
  }
}

function sign(magnitude: number, of: number): number {
  return of >= 0 ? Math.abs(magnitude) : -Math.abs(magnitude)
}

/** Francis double-shift QR on an upper Hessenberg matrix. Destroys its input. */
function francisQr(a: Matrix, n: number): ComplexEigenvalue[] {
  const wr = new Float64Array(n + 1)
  const wi = new Float64Array(n + 1)

  let anorm = 0
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a.get(i, j))
  }

  let nn = n
  let t = 0

  while (nn >= 1) {
    let its = 0
    let l = 1
    do {
      // Search for a negligible subdiagonal entry, which splits the problem.
      l = 1
      for (let candidate = nn; candidate >= 2; candidate--) {
        let s = Math.abs(a.get(candidate - 1, candidate - 1)) + Math.abs(a.get(candidate, candidate))
        if (s === 0) s = anorm
        if (Math.abs(a.get(candidate, candidate - 1)) + s === s) {
          a.set(candidate, candidate - 1, 0)
          l = candidate
          break
        }
      }

      let x = a.get(nn, nn)
      if (l === nn) {
        // One real eigenvalue has converged.
        wr[nn] = x + t
        wi[nn] = 0
        nn--
        continue
      }

      const y = a.get(nn - 1, nn - 1)
      const w = a.get(nn, nn - 1) * a.get(nn - 1, nn)

      if (l === nn - 1) {
        // A trailing two by two block: solve it directly.
        const p = 0.5 * (y - x)
        const q = p * p + w
        let z = Math.sqrt(Math.abs(q))
        x += t
        if (q >= 0) {
          z = p + sign(z, p)
          wr[nn - 1] = x + z
          wr[nn] = z !== 0 ? x - w / z : x + z
          wi[nn - 1] = 0
          wi[nn] = 0
        } else {
          wr[nn - 1] = x + p
          wr[nn] = x + p
          wi[nn] = z
          wi[nn - 1] = -z
        }
        nn -= 2
        continue
      }

      if (its === MAX_ITERATIONS) {
        throw new Error('francisQr: failed to converge')
      }

      let yy = y
      let ww = w
      if (its !== 0 && its % 10 === 0) {
        // Exceptional shift, to break out of a cycle the usual shift cannot.
        t += x
        for (let i = 1; i <= nn; i++) a.set(i, i, a.get(i, i) - x)
        const s = Math.abs(a.get(nn, nn - 1)) + Math.abs(a.get(nn - 1, nn - 2))
        x = 0.75 * s
        yy = x
        ww = -0.4375 * s * s
      }
      its++

      // Find two consecutive small subdiagonal entries to start the bulge from.
      let m = nn - 2
      let p = 0
      let q = 0
      let r = 0
      for (; m >= l; m--) {
        const z = a.get(m, m)
        const rr = x - z
        const ss = yy - z
        p = (rr * ss - ww) / a.get(m + 1, m) + a.get(m, m + 1)
        q = a.get(m + 1, m + 1) - z - rr - ss
        r = a.get(m + 2, m + 1)
        const s = Math.abs(p) + Math.abs(q) + Math.abs(r)
        p /= s
        q /= s
        r /= s
        if (m === l) break
        const u = Math.abs(a.get(m, m - 1)) * (Math.abs(q) + Math.abs(r))
        const v =
          Math.abs(p) *
          (Math.abs(a.get(m - 1, m - 1)) + Math.abs(z) + Math.abs(a.get(m + 1, m + 1)))
        if (u + v === v) break
      }
      if (m < l) m = l

      for (let i = m + 2; i <= nn; i++) {
        a.set(i, i - 2, 0)
        if (i !== m + 2) a.set(i, i - 3, 0)
      }

      // Chase the bulge down the subdiagonal with Householder reflections.
      for (let k = m; k <= nn - 1; k++) {
        if (k !== m) {
          p = a.get(k, k - 1)
          q = a.get(k + 1, k - 1)
          r = k !== nn - 1 ? a.get(k + 2, k - 1) : 0
          x = Math.abs(p) + Math.abs(q) + Math.abs(r)
          if (x !== 0) {
            p /= x
            q /= x
            r /= x
          }
        }

        const s = sign(Math.sqrt(p * p + q * q + r * r), p)
        if (s === 0) continue

        if (k === m) {
          if (l !== m) a.set(k, k - 1, -a.get(k, k - 1))
        } else {
          a.set(k, k - 1, -s * x)
        }
        p += s
        const px = p / s
        const py = q / s
        const pz = r / s
        q /= p
        r /= p

        for (let j = k; j <= nn; j++) {
          let acc = a.get(k, j) + q * a.get(k + 1, j)
          if (k !== nn - 1) {
            acc += r * a.get(k + 2, j)
            a.set(k + 2, j, a.get(k + 2, j) - acc * pz)
          }
          a.set(k + 1, j, a.get(k + 1, j) - acc * py)
          a.set(k, j, a.get(k, j) - acc * px)
        }

        const mmin = nn < k + 3 ? nn : k + 3
        for (let i = l; i <= mmin; i++) {
          let acc = px * a.get(i, k) + py * a.get(i, k + 1)
          if (k !== nn - 1) {
            acc += pz * a.get(i, k + 2)
            a.set(i, k + 2, a.get(i, k + 2) - acc * r)
          }
          a.set(i, k + 1, a.get(i, k + 1) - acc * q)
          a.set(i, k, a.get(i, k) - acc)
        }
      }
    } while (l < nn - 1 && nn >= 1)
  }

  const out: ComplexEigenvalue[] = []
  for (let i = 1; i <= n; i++) out.push({ re: wr[i] as number, im: wi[i] as number })
  return out
}

/** Eigenvalues of a real square matrix, in no particular order. */
export function unsymmetricEigenvalues(input: Matrix): ComplexEigenvalue[] {
  const n = input.rows
  if (input.cols !== n) throw new Error('unsymmetricEigenvalues: matrix must be square')
  if (n === 0) return []

  // Shift into 1-based storage.
  const a = Matrix.zeros(n + 1, n + 1)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a.set(i + 1, j + 1, input.get(i, j))
  }

  balance(a, n)
  hessenberg(a, n)
  return francisQr(a, n)
}
