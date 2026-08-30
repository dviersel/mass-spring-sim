import { describe, expect, it } from 'vitest'
import { Matrix } from '../../src/core/linalg'
import { assembleChain } from '../../src/core/assemble'
import { quietSegment, uniformChain, type ChainSpec } from '../../src/core/chain'
import { unsymmetricEigenvalues } from '../../src/core/eigen/hqr'
import { analyseModes } from '../../src/core/eigen/modal'

const MASS = 0.05

function chain(totalDamping: number, nodeCount = 11): ChainSpec {
  return uniformChain({
    nodeCount,
    length: 1,
    totalStiffness: 100,
    totalDamping,
    mass: MASS,
    drivenNodes: [0, nodeCount - 1],
  })
}

describe('unsymmetric eigenvalue solver', () => {
  it('recovers the eigenvalues of a diagonal matrix', () => {
    const a = Matrix.fromRows([
      [3, 0, 0],
      [0, -7, 0],
      [0, 0, 1.5],
    ])
    const values = unsymmetricEigenvalues(a)
      .map((v) => v.re)
      .sort((x, y) => x - y)
    expect(values[0]).toBeCloseTo(-7, 12)
    expect(values[1]).toBeCloseTo(1.5, 12)
    expect(values[2]).toBeCloseTo(3, 12)
  })

  it('recovers a known complex conjugate pair', () => {
    // Rotation-and-scale block with eigenvalues 2 +/- 3i.
    const a = Matrix.fromRows([
      [2, -3],
      [3, 2],
    ])
    const values = unsymmetricEigenvalues(a)
    expect(values).toHaveLength(2)
    for (const v of values) {
      expect(v.re).toBeCloseTo(2, 12)
      expect(Math.abs(v.im)).toBeCloseTo(3, 12)
    }
    expect((values[0] as { im: number }).im + (values[1] as { im: number }).im).toBeCloseTo(0, 12)
  })

  it('recovers eigenvalues of an upper triangular matrix from its diagonal', () => {
    const a = Matrix.fromRows([
      [4, 9, -2, 7],
      [0, -1, 5, 3],
      [0, 0, 2.25, 8],
      [0, 0, 0, -6],
    ])
    const values = unsymmetricEigenvalues(a)
      .map((v) => v.re)
      .sort((x, y) => x - y)
    expect(values).toHaveLength(4)
    expect(values[0]).toBeCloseTo(-6, 10)
    expect(values[1]).toBeCloseTo(-1, 10)
    expect(values[2]).toBeCloseTo(2.25, 10)
    expect(values[3]).toBeCloseTo(4, 10)
  })
})

describe('damping ratios', () => {
  it('reports zero damping for an undamped chain, and frequencies matching Jacobi', () => {
    const spec = chain(0)
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    for (const mode of analysis.modes) {
      expect(mode.zeta).toBeCloseTo(0, 10)
      expect(mode.oscillatory).toBe(true)
      expect(mode.dampedFrequencyHz).toBeCloseTo(mode.frequencyHz, 10)
      expect(mode.decayTime).toBe(Number.POSITIVE_INFINITY)
    }
  })

  it('matches the exact proportional result when c/k is uniform', () => {
    // Stiffness and damping share the same inverse-length law, so C = alpha.K
    // exactly with alpha = c_total / k_total. That is classical damping, whose
    // damping ratios are known in closed form: zeta_r = alpha . omega_r / 2.
    const spec = chain(0.5)
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    const alpha = spec.totalDamping / spec.totalStiffness

    expect(analysis.classicallyDamped).toBe(true)
    expect(analysis.nonProportionality).toBeLessThan(1e-12)

    for (const mode of analysis.modes) {
      expect(mode.zeta).toBeCloseTo((alpha * mode.omega) / 2, 10)
    }
    // Higher modes are far more heavily damped under stiffness-proportional
    // damping, which is exactly the intuition the display should convey.
    const first = analysis.modes[0] as { zeta: number }
    const last = analysis.modes[analysis.modes.length - 1] as { zeta: number }
    expect(last.zeta).toBeGreaterThan(first.zeta * 5)
  })

  it('handles a chain where the high modes are overdamped and the low ones ring', () => {
    const spec = chain(2)
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    const alpha = spec.totalDamping / spec.totalStiffness

    const oscillatory = analysis.modes.filter((mode) => mode.oscillatory)
    const overdamped = analysis.modes.filter((mode) => !mode.oscillatory)
    expect(oscillatory.length).toBeGreaterThan(0)
    expect(overdamped.length).toBeGreaterThan(0)

    // The closed-form ratio holds across both regimes.
    for (const mode of analysis.modes) {
      expect(mode.zeta).toBeCloseTo((alpha * mode.omega) / 2, 8)
    }
    for (const mode of overdamped) {
      expect(mode.zeta).toBeGreaterThanOrEqual(1)
      expect(mode.dampedFrequencyHz).toBe(0)
    }
  })

  it('conserves the trace of the state-space matrix', () => {
    // Independent of any pairing logic: the eigenvalues of A must sum to
    // trace(A) = -trace(M^-1 C). If the solver lost or duplicated a root this
    // fails regardless of how the roots are matched to modes.
    const spec = chain(0.7, 9)
    const m = assembleChain(spec)
    const n = m.dof

    const a = Matrix.zeros(2 * n, 2 * n)
    let expectedTrace = 0
    for (let i = 0; i < n; i++) {
      a.set(i, n + i, 1)
      const invM = 1 / m.Mff.get(i, i)
      for (let j = 0; j < n; j++) {
        a.set(n + i, j, -invM * m.Kff.get(i, j))
        a.set(n + i, n + j, -invM * m.Cff.get(i, j))
      }
      expectedTrace -= (1 / m.Mff.get(i, i)) * m.Cff.get(i, i)
    }

    const spectrum = unsymmetricEigenvalues(a)
    expect(spectrum).toHaveLength(2 * n)
    const sumRe = spectrum.reduce((acc, v) => acc + v.re, 0)
    const sumIm = spectrum.reduce((acc, v) => acc + v.im, 0)
    expect(sumRe / expectedTrace).toBeCloseTo(1, 8)
    expect(sumIm).toBeCloseTo(0, 6)
  })
})

describe('non-proportional damping is detected, not hidden', () => {
  it('flags a chain whose dashpots do not follow its springs', () => {
    // Overriding one segment's damping breaks C = alpha.K, so the real mode
    // shapes stop being the true damped ones. The system must say so.
    const base = chain(0.5, 7)
    const spec: ChainSpec = {
      ...base,
      segments: base.segments.map((s, i) => (i === 2 ? { ...s, dampingOverride: 40 } : s)),
    }
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)

    expect(analysis.classicallyDamped).toBe(false)
    expect(analysis.nonProportionality).toBeGreaterThan(1e-3)

    // And the exact ratios genuinely differ from what the proportional formula
    // would have claimed -- so this is not a distinction without a difference.
    const modalC = analysis.shapes.transpose().mul(m.Cff).mul(analysis.shapes)
    let worstDisagreement = 0
    for (const mode of analysis.modes) {
      const projected = modalC.get(mode.index, mode.index) / (2 * mode.omega)
      worstDisagreement = Math.max(worstDisagreement, Math.abs(projected - mode.zeta))
    }
    expect(worstDisagreement).toBeGreaterThan(1e-3)
  })

  it('treats unequal spacing alone as still classically damped', () => {
    // Both k and c scale as inverse length, so uneven spacing on its own keeps
    // c/k uniform. Only an explicit override breaks proportionality.
    const positions = [0, 0.07, 0.3, 0.42, 0.75, 1]
    const spec: ChainSpec = {
      nodes: positions.map((position, i) => ({
        position,
        mass: MASS,
        driven: i === 0 || i === positions.length - 1,
        motion: { kind: 'off' as const },
        force: { kind: 'off' as const },
      })),
      segments: positions.slice(1).map(() => quietSegment()),
      totalStiffness: 100,
      totalDamping: 0.5,
    }
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    expect(analysis.classicallyDamped).toBe(true)
    for (const mode of analysis.modes) {
      expect(mode.zeta).toBeCloseTo((0.005 * mode.omega) / 2, 9)
    }
  })
})

describe('the state-space solver holds up at larger sizes', () => {
  // The Francis QR path is the most intricate code in the project, and it grows
  // as 2N. A 21-node chain means a 38x38 unsymmetric eigenproblem, which is
  // where a shift or deflation mistake would surface first.
  it.each([5, 11, 17, 21, 31])('matches the closed form on a %i-node chain', (nodeCount) => {
    const spec = chain(0.4, nodeCount)
    const m = assembleChain(spec)
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    const alpha = spec.totalDamping / spec.totalStiffness

    expect(analysis.modes).toHaveLength(nodeCount - 2)
    expect(analysis.classicallyDamped).toBe(true)

    for (const mode of analysis.modes) {
      expect(Number.isFinite(mode.zeta)).toBe(true)
      expect(mode.zeta).toBeCloseTo((alpha * mode.omega) / 2, 7)
    }
  })

  it('keeps frequencies strictly ordered and positive throughout', () => {
    const m = assembleChain(chain(0.4, 31))
    const analysis = analyseModes(m.Mff, m.Cff, m.Kff)
    for (let r = 1; r < analysis.modes.length; r++) {
      const previous = analysis.modes[r - 1]
      const current = analysis.modes[r]
      expect(current?.omega).toBeGreaterThan(previous?.omega ?? 0)
    }
  })
})
