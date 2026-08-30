/**
 * View settings: everything that affects how the simulation is DRAWN and
 * nothing that affects how it behaves.
 *
 * The core works in strict SI, where this system's displacements are
 * millimetres and its frequencies are tens of hertz. Neither is watchable at
 * life size and real time, so both need independent exaggeration -- and both
 * must stay strictly on this side of the boundary. `timeScale` is applied when
 * converting a frame delta into simulated seconds, never inside the
 * integrator; `displacementExaggeration` is applied when converting metres to
 * pixels, never to the state.
 */

/**
 * How displacement is DRAWN, which is separate from the direction the masses
 * actually move. Named for the drawing so it cannot be confused with the
 * chain's motion regime: 'perpendicular' offsets the chain across the axis,
 * 'inline' slides the masses along it.
 *
 * In the transverse regime only 'perpendicular' is truthful, and the UI holds
 * it there.
 */
export type Orientation = 'perpendicular' | 'inline'

export interface ViewSettings {
  /** Simulated seconds per wall-clock second. Below 1 is slow motion. */
  readonly timeScale: number
  /** Displacements are drawn this many times life size. */
  readonly displacementExaggeration: number
  readonly orientation: Orientation
  /** Node index the time trace follows. */
  readonly tracedNode: number
  /** Simulated seconds visible in the time trace. */
  readonly traceWindow: number
  /** Mode number (1-based) to overlay as a dashed reference shape, or null. */
  readonly overlayMode: number | null
  /**
   * How the per-node history is drawn in the main pane, time running up it.
   *
   * `pens` draws one line per node. `ribbon` additionally fills each gap
   * between neighbouring pens with a gradient running from one pen's colour to
   * the next, so the chain reads as a single continuous surface rather than as
   * eleven separate records.
   *
   * Only meaningful alongside the inline drawing: both need the vertical axis
   * for time, and the perpendicular drawing has already spent it on
   * displacement.
   */
  readonly seismograph: SeismographMode
}

export type SeismographMode = 'off' | 'pens' | 'ribbon'

export const DEFAULT_VIEW: ViewSettings = {
  // Mode 1 sits near 7 Hz and mode 9 near 44 Hz. At 0.15 the fundamental reads
  // as roughly one hertz on screen -- slow enough to follow, fast enough that a
  // resonance still builds while you watch.
  timeScale: 0.15,
  // Suited to the inline drawing, where displacement competes with the node
  // spacing itself: at 1 m over 10 segments a millimetre of motion reads as a
  // useful fraction of a segment here, whereas the exaggeration the
  // perpendicular plot can carry would send neighbours straight through each
  // other.
  displacementExaggeration: 22,
  orientation: 'inline',
  tracedNode: 3,
  traceWindow: 2.5,
  overlayMode: null,
  seismograph: 'ribbon',
}

export const TIME_SCALE_RANGE = { min: 0.005, max: 1 } as const
export const EXAGGERATION_RANGE = { min: 2, max: 2000 } as const

/** Sliders for quantities spanning decades read far better on a log scale. */
export function toLogSlider(value: number, range: { min: number; max: number }): number {
  const t = Math.log(value / range.min) / Math.log(range.max / range.min)
  return Math.min(1, Math.max(0, t))
}

export function fromLogSlider(t: number, range: { min: number; max: number }): number {
  return range.min * Math.pow(range.max / range.min, Math.min(1, Math.max(0, t)))
}
