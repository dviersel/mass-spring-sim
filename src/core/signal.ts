/**
 * Driving signals.
 *
 * Every signal reports its value AND its exact analytical time derivative.
 * That pairing is structural, not a convention: `evaluateSignal` can only
 * return both together, so a signal without a derivative cannot be expressed.
 * The dashpots need the velocity of an imposed motion, and RK4 samples at
 * intermediate times, so a finite difference would be both wrong and
 * unavailable.
 *
 * Signals are plain serialisable data rather than closures, so the UI can edit
 * them live and presets can round-trip them.
 *
 * Amplitude is unit-agnostic -- metres for prescribed motion and actuator
 * stroke, newtons for an external force, dimensionless for stiffness
 * modulation. The caller supplies the meaning.
 */

export type SignalSpec =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'sine'
      readonly amplitude: number
      /** Hz. */
      readonly frequency: number
      /** Radians. */
      readonly phase: number
    }
  | {
      readonly kind: 'chirp'
      readonly amplitude: number
      /** Hz at the start of the sweep. */
      readonly startFrequency: number
      /** Hz at the end of the sweep. */
      readonly endFrequency: number
      /** Sweep duration, seconds. */
      readonly duration: number
      /** Simulation time at which the sweep begins, seconds. */
      readonly startTime: number
      /** Radians. */
      readonly phase: number
    }
  | {
      readonly kind: 'step'
      readonly amplitude: number
      /** Simulation time at which the ramp begins, seconds. */
      readonly startTime: number
      /**
       * Raised-cosine rise time, seconds. Must be > 0: a zero rise time is a
       * displacement discontinuity, which implies infinite velocity through
       * the dashpots. Non-positive values are treated as an instantaneous
       * jump with zero reported derivative, which is a lie the UI prevents.
       */
      readonly riseTime: number
    }

export interface SignalSample {
  readonly value: number
  /** d(value)/dt, evaluated analytically. */
  readonly derivative: number
}

const ZERO: SignalSample = { value: 0, derivative: 0 }
const TAU = Math.PI * 2

export function evaluateSignal(spec: SignalSpec, t: number): SignalSample {
  switch (spec.kind) {
    case 'off':
      return ZERO

    case 'sine': {
      const omega = TAU * spec.frequency
      const arg = omega * t + spec.phase
      return {
        value: spec.amplitude * Math.sin(arg),
        derivative: spec.amplitude * omega * Math.cos(arg),
      }
    }

    case 'chirp': {
      const { amplitude, startFrequency: f0, endFrequency: f1, duration, phase } = spec
      const tau = t - spec.startTime

      // Phase and instantaneous angular frequency, pieced together so that the
      // signal is C1 across both ends of the sweep. Before the sweep it simply
      // oscillates at f0, after it at f1, with phase carried across. A jump in
      // either value or slope would inject a spurious impulse through the
      // dashpots at the moment the sweep starts or stops.
      let phi: number
      let phiDot: number
      if (duration <= 0) {
        phi = phase + TAU * f1 * tau
        phiDot = TAU * f1
      } else if (tau < 0) {
        phi = phase + TAU * f0 * tau
        phiDot = TAU * f0
      } else if (tau <= duration) {
        phi = phase + TAU * (f0 * tau + ((f1 - f0) * tau * tau) / (2 * duration))
        phiDot = TAU * (f0 + ((f1 - f0) * tau) / duration)
      } else {
        const phiAtEnd = phase + TAU * duration * ((f0 + f1) / 2)
        phi = phiAtEnd + TAU * f1 * (tau - duration)
        phiDot = TAU * f1
      }

      return {
        value: amplitude * Math.sin(phi),
        derivative: amplitude * phiDot * Math.cos(phi),
      }
    }

    case 'step': {
      const tau = t - spec.startTime
      if (tau <= 0) return ZERO
      if (spec.riseTime <= 0) return { value: spec.amplitude, derivative: 0 }
      if (tau >= spec.riseTime) return { value: spec.amplitude, derivative: 0 }

      // Raised cosine: zero slope at both ends, so value and derivative are
      // both continuous where the ramp joins the flat sections.
      const w = (Math.PI * tau) / spec.riseTime
      return {
        value: (spec.amplitude * (1 - Math.cos(w))) / 2,
        derivative: ((spec.amplitude * Math.PI) / (2 * spec.riseTime)) * Math.sin(w),
      }
    }
  }
}

/** True when the signal can never contribute anything. Lets callers skip work. */
export function isSilent(spec: SignalSpec): boolean {
  return spec.kind === 'off' || spec.amplitude === 0
}

/**
 * Instantaneous frequency in Hz, for display. Undefined for signals that have
 * no meaningful frequency (off, step).
 */
export function instantaneousFrequency(spec: SignalSpec, t: number): number | undefined {
  switch (spec.kind) {
    case 'sine':
      return spec.frequency
    case 'chirp': {
      if (spec.duration <= 0) return spec.endFrequency
      const tau = t - spec.startTime
      if (tau < 0) return spec.startFrequency
      if (tau > spec.duration) return spec.endFrequency
      return spec.startFrequency + ((spec.endFrequency - spec.startFrequency) * tau) / spec.duration
    }
    default:
      return undefined
  }
}

export const OFF: SignalSpec = { kind: 'off' }

export function sine(amplitude: number, frequency: number, phase = 0): SignalSpec {
  return { kind: 'sine', amplitude, frequency, phase }
}

export function chirp(
  amplitude: number,
  startFrequency: number,
  endFrequency: number,
  duration: number,
  startTime = 0,
  phase = 0,
): SignalSpec {
  return { kind: 'chirp', amplitude, startFrequency, endFrequency, duration, startTime, phase }
}

export function step(amplitude: number, startTime: number, riseTime: number): SignalSpec {
  return { kind: 'step', amplitude, startTime, riseTime }
}
