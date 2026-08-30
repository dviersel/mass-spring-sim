/**
 * Fixed-step RK4 integration with a substep accumulator.
 *
 * Two rules the brief calls out, both implemented here:
 *
 *  - The timestep is fixed. A frame delta is accumulated and drained in whole
 *    steps; whatever is left over stays in the accumulator for next frame.
 *    Feeding a variable frame delta straight into the integrator would make the
 *    physics depend on frame rate, which for a resonant system means the
 *    resonance itself moves when the browser stutters.
 *
 *  - RK4 evaluates the derivative at t, t+h/2 (twice) and t+h. Every driving
 *    signal is therefore sampled at times that are not frame boundaries, which
 *    is why signals must be closed-form functions of t rather than anything
 *    stateful or incrementally updated.
 */

import { Vec } from './linalg'

/** Writes the acceleration of the free degrees of freedom at (t, x, v) into out. */
export type AccelerationFn = (t: number, x: Vec, v: Vec, out: Vec) => void

export class Rk4Workspace {
  readonly xt: Vec
  readonly vt: Vec
  readonly a1: Vec
  readonly a2: Vec
  readonly a3: Vec
  readonly a4: Vec
  readonly v1: Vec
  readonly v2: Vec
  readonly v3: Vec
  readonly v4: Vec

  constructor(dof: number) {
    this.xt = Vec.zeros(dof)
    this.vt = Vec.zeros(dof)
    this.a1 = Vec.zeros(dof)
    this.a2 = Vec.zeros(dof)
    this.a3 = Vec.zeros(dof)
    this.a4 = Vec.zeros(dof)
    this.v1 = Vec.zeros(dof)
    this.v2 = Vec.zeros(dof)
    this.v3 = Vec.zeros(dof)
    this.v4 = Vec.zeros(dof)
  }
}

/**
 * One classical RK4 step of xdot = v, vdot = a(t, x, v). Advances x and v in
 * place; the caller owns the clock.
 */
export function rk4Step(
  t: number,
  h: number,
  x: Vec,
  v: Vec,
  acceleration: AccelerationFn,
  w: Rk4Workspace,
): void {
  const half = h / 2

  // Stage 1, at t.
  w.v1.copyFrom(v)
  acceleration(t, x, v, w.a1)

  // Stage 2, at t + h/2.
  x.addScaledInto(w.v1, half, w.xt)
  v.addScaledInto(w.a1, half, w.vt)
  w.v2.copyFrom(w.vt)
  acceleration(t + half, w.xt, w.vt, w.a2)

  // Stage 3, at t + h/2.
  x.addScaledInto(w.v2, half, w.xt)
  v.addScaledInto(w.a2, half, w.vt)
  w.v3.copyFrom(w.vt)
  acceleration(t + half, w.xt, w.vt, w.a3)

  // Stage 4, at t + h.
  x.addScaledInto(w.v3, h, w.xt)
  v.addScaledInto(w.a3, h, w.vt)
  w.v4.copyFrom(w.vt)
  acceleration(t + h, w.xt, w.vt, w.a4)

  const sixth = h / 6
  for (let i = 0; i < x.n; i++) {
    x.set(
      i,
      x.get(i) + sixth * (w.v1.get(i) + 2 * w.v2.get(i) + 2 * w.v3.get(i) + w.v4.get(i)),
    )
    v.set(
      i,
      v.get(i) + sixth * (w.a1.get(i) + 2 * w.a2.get(i) + 2 * w.a3.get(i) + w.a4.get(i)),
    )
  }
}

/** Steps per period of the fastest mode. Comfortably inside RK4 stability. */
const STEPS_PER_SHORTEST_PERIOD = 40

/**
 * A timestep that resolves the fastest mode well.
 *
 * RK4 is stable on the imaginary axis up to |omega.h| = 2*sqrt(2) ~ 2.83, but
 * stability is a low bar; 40 steps per period puts |omega.h| near 0.16, where
 * amplitude error over many cycles is negligible. That matters because the
 * whole point is watching resonance build slowly.
 */
export function suggestTimestep(omegaMax: number): number {
  if (!(omegaMax > 0)) return 1 / 1000
  const shortestPeriod = (2 * Math.PI) / omegaMax
  return shortestPeriod / STEPS_PER_SHORTEST_PERIOD
}

/** How close a timestep sits to the RK4 stability limit. Above 1 will diverge. */
export function stabilityRatio(dt: number, omegaMax: number): number {
  return (dt * omegaMax) / (2 * Math.SQRT2)
}

export interface SubstepResult {
  /** Fixed steps actually taken this frame. */
  readonly steps: number
  /** Simulated seconds discarded because the substep budget ran out. */
  readonly droppedSeconds: number
}

/**
 * Drains simulated time into whole fixed steps.
 *
 * The substep cap is what stops a slow frame from requesting more work than
 * the next frame has time for, which would request more still: the simulation
 * falls behind real time instead of locking the page up.
 */
export class SubstepAccumulator {
  private accumulator = 0

  constructor(
    public dt: number,
    public maxStepsPerFrame = 240,
  ) {}

  reset(): void {
    this.accumulator = 0
  }

  /** @param simSeconds Simulated seconds to advance -- already time-scaled. */
  drain(simSeconds: number, step: () => void): SubstepResult {
    if (simSeconds > 0) this.accumulator += simSeconds

    let steps = 0
    while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
      step()
      this.accumulator -= this.dt
      steps++
    }

    let droppedSeconds = 0
    if (steps === this.maxStepsPerFrame && this.accumulator >= this.dt) {
      droppedSeconds = this.accumulator
      this.accumulator = 0
    }
    return { steps, droppedSeconds }
  }
}
