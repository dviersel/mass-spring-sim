/**
 * Minimal dense linear algebra for small systems (N of order tens).
 *
 * Matrix and Vec wrap Float64Array behind accessors rather than exposing raw
 * indexing. That keeps `noUncheckedIndexedAccess` switched on project-wide --
 * which is what guards the dynamic degree-of-freedom indexing elsewhere in the
 * core -- without scattering non-null assertions through every numeric loop.
 */

export class Vec {
  readonly n: number
  readonly data: Float64Array

  constructor(n: number, data?: Float64Array) {
    this.n = n
    this.data = data ?? new Float64Array(n)
  }

  static zeros(n: number): Vec {
    return new Vec(n)
  }

  static from(values: readonly number[]): Vec {
    return new Vec(values.length, Float64Array.from(values))
  }

  get(i: number): number {
    return this.data[i] as number
  }

  set(i: number, value: number): void {
    this.data[i] = value
  }

  add(i: number, value: number): void {
    this.data[i] = (this.data[i] as number) + value
  }

  fill(value: number): void {
    this.data.fill(value)
  }

  clone(): Vec {
    return new Vec(this.n, this.data.slice())
  }

  copyFrom(other: Vec): void {
    this.data.set(other.data)
  }

  /** this += scale * other, in place. */
  addScaled(other: Vec, scale: number): void {
    for (let i = 0; i < this.n; i++) {
      this.data[i] = (this.data[i] as number) + scale * other.get(i)
    }
  }

  /** out = this + scale * other, into a caller-owned destination. */
  addScaledInto(other: Vec, scale: number, out: Vec): void {
    for (let i = 0; i < this.n; i++) {
      out.set(i, (this.data[i] as number) + scale * other.get(i))
    }
  }

  scale(factor: number): void {
    for (let i = 0; i < this.n; i++) {
      this.data[i] = (this.data[i] as number) * factor
    }
  }

  dot(other: Vec): number {
    let sum = 0
    for (let i = 0; i < this.n; i++) sum += (this.data[i] as number) * other.get(i)
    return sum
  }

  norm(): number {
    return Math.sqrt(this.dot(this))
  }

  toArray(): number[] {
    return Array.from(this.data)
  }
}

export class Matrix {
  readonly rows: number
  readonly cols: number
  readonly data: Float64Array

  constructor(rows: number, cols: number, data?: Float64Array) {
    this.rows = rows
    this.cols = cols
    this.data = data ?? new Float64Array(rows * cols)
  }

  static zeros(rows: number, cols: number): Matrix {
    return new Matrix(rows, cols)
  }

  static identity(n: number): Matrix {
    const m = new Matrix(n, n)
    for (let i = 0; i < n; i++) m.set(i, i, 1)
    return m
  }

  /** Build from row-major nested arrays. Intended for tests and fixtures. */
  static fromRows(rows: readonly (readonly number[])[]): Matrix {
    const r = rows.length
    const c = rows[0]?.length ?? 0
    const m = new Matrix(r, c)
    for (let i = 0; i < r; i++) {
      const row = rows[i]
      if (row === undefined || row.length !== c) {
        throw new Error('Matrix.fromRows: ragged input')
      }
      for (let j = 0; j < c; j++) m.set(i, j, row[j] as number)
    }
    return m
  }

  get(i: number, j: number): number {
    return this.data[i * this.cols + j] as number
  }

  set(i: number, j: number, value: number): void {
    this.data[i * this.cols + j] = value
  }

  /** Accumulate into an entry. The natural operation for stiffness assembly. */
  add(i: number, j: number, value: number): void {
    const k = i * this.cols + j
    this.data[k] = (this.data[k] as number) + value
  }

  fill(value: number): void {
    this.data.fill(value)
  }

  clone(): Matrix {
    return new Matrix(this.rows, this.cols, this.data.slice())
  }

  /** out = this * v. */
  mulVecInto(v: Vec, out: Vec): void {
    for (let i = 0; i < this.rows; i++) {
      let sum = 0
      for (let j = 0; j < this.cols; j++) sum += this.get(i, j) * v.get(j)
      out.set(i, sum)
    }
  }

  mulVec(v: Vec): Vec {
    const out = Vec.zeros(this.rows)
    this.mulVecInto(v, out)
    return out
  }

  mul(other: Matrix): Matrix {
    const out = Matrix.zeros(this.rows, other.cols)
    for (let i = 0; i < this.rows; i++) {
      for (let k = 0; k < this.cols; k++) {
        const a = this.get(i, k)
        if (a === 0) continue
        for (let j = 0; j < other.cols; j++) {
          out.add(i, j, a * other.get(k, j))
        }
      }
    }
    return out
  }

  transpose(): Matrix {
    const out = Matrix.zeros(this.cols, this.rows)
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) out.set(j, i, this.get(i, j))
    }
    return out
  }

  /** Largest absolute difference from the transpose. Diagnostic for assembly. */
  asymmetry(): number {
    let worst = 0
    for (let i = 0; i < this.rows; i++) {
      for (let j = i + 1; j < this.cols; j++) {
        worst = Math.max(worst, Math.abs(this.get(i, j) - this.get(j, i)))
      }
    }
    return worst
  }

  toRows(): number[][] {
    const out: number[][] = []
    for (let i = 0; i < this.rows; i++) {
      const row: number[] = []
      for (let j = 0; j < this.cols; j++) row.push(this.get(i, j))
      out.push(row)
    }
    return out
  }
}
