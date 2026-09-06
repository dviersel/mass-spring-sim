/**
 * Scrolling time trace, in four readings of the same history.
 *
 * Participation bars say which modes are ringing; this says how that changed
 * over time, which is what "watch resonance build and decay" actually looks
 * like. The horizontal axis is SIMULATED seconds, not wall-clock, so changing
 * the time scale slows the sweep without changing what the trace means.
 *
 * `single` follows one node. `modal` takes that node apart into one harmonic
 * per mode and lays their sum back over the top -- the sum is the trace, and
 * drawing both is what makes the decomposition checkable by eye rather than
 * asserted. `sum` adds every node instead, and `all` overlays them.
 */

import { COLORS, prepare, seriesColor } from './theme'
import type { NodeTraceBuffer } from './seismograph'
import type { TraceMode } from '../view'

export class TraceBuffer {
  private times: Float64Array
  private values: Float64Array
  private head = 0
  private count = 0

  constructor(private capacity = 4096) {
    this.times = new Float64Array(capacity)
    this.values = new Float64Array(capacity)
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }

  push(time: number, value: number): void {
    this.times[this.head] = time
    this.values[this.head] = value
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** Visits samples oldest-first. */
  forEach(visit: (time: number, value: number) => void): void {
    const start = (this.head - this.count + this.capacity) % this.capacity
    for (let i = 0; i < this.count; i++) {
      const index = (start + i) % this.capacity
      visit(this.times[index] as number, this.values[index] as number)
    }
  }

  get size(): number {
    return this.count
  }
}

/** Everything the decomposed reading needs beyond the history itself. */
export interface ModalSource {
  /** One channel per mode, holding the signed modal coordinate q_r(t). */
  readonly coordinates: NodeTraceBuffer
  /**
   * The traced node's entry in each mode shape, so a coordinate becomes that
   * mode's contribution to THIS node. Held apart from the history because it
   * changes when the traced node does, while the history does not.
   */
  readonly shape: Float64Array
  /**
   * Why the decomposition cannot be drawn, or null when it can. A driven node
   * has no modal coordinates -- its motion is imposed rather than solved -- and
   * under time-varying stiffness the shapes describe a spring that is no longer
   * there.
   */
  readonly unavailable: string | null
}

export interface TraceFrame {
  readonly mode: TraceMode
  readonly buffer: TraceBuffer
  /** Per-node history, for the readings that need more than one node. */
  readonly history: NodeTraceBuffer | null
  readonly modal: ModalSource | null
  /** Current simulated time, seconds. The right-hand edge of the plot. */
  readonly now: number
  /** Simulated seconds visible. */
  readonly window: number
  readonly nodeIndex: number
  /** Half-height of the plot in metres. Smoothed by the caller. */
  readonly scale: number
}

const PAD_LEFT = 40
const PAD_RIGHT = 8
const PAD_Y = 12

export function drawTrace(canvas: HTMLCanvasElement, frame: TraceFrame): void {
  const surface = prepare(canvas)
  if (surface === null) return
  const { ctx, width, height } = surface

  ctx.fillStyle = COLORS.panel
  ctx.fillRect(0, 0, width, height)

  const plotWidth = width - PAD_LEFT - PAD_RIGHT
  const midY = height / 2
  const halfHeight = height / 2 - PAD_Y
  const scale = frame.scale > 0 ? frame.scale : 1e-6

  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_LEFT, midY)
  ctx.lineTo(width - PAD_RIGHT, midY)
  ctx.stroke()

  ctx.fillStyle = COLORS.dim
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'right'
  ctx.fillText(`+${(scale * 1000).toFixed(2)}`, PAD_LEFT - 6, PAD_Y + 8)
  ctx.fillText('0', PAD_LEFT - 6, midY + 3)
  ctx.fillText(`-${(scale * 1000).toFixed(2)}`, PAD_LEFT - 6, height - PAD_Y - 1)

  const oldest = frame.now - frame.window
  const plot = {
    x: (time: number): number => PAD_LEFT + ((time - oldest) / frame.window) * plotWidth,
    // Clamped rather than clipped: a curve that leaves the pane should say so
    // by running along its edge, not vanish and look like a gap in the data.
    y: (value: number): number =>
      midY - Math.max(-1.6, Math.min(1.6, value / scale)) * halfHeight,
  }

  /** One polyline from a sampler that visits (time, value) oldest-first. */
  const stroke = (
    visit: (each: (time: number, value: number) => void) => void,
    colour: string,
    lineWidth: number,
    alpha = 1,
  ): void => {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = colour
    ctx.lineWidth = lineWidth
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let started = false
    visit((time, value) => {
      if (time < oldest) return
      const x = plot.x(time)
      const y = plot.y(value)
      if (started) ctx.lineTo(x, y)
      else {
        ctx.moveTo(x, y)
        started = true
      }
    })
    ctx.stroke()
    ctx.restore()
  }

  let caption = `node ${frame.nodeIndex}`
  const history = frame.history

  if (frame.mode === 'all' && history !== null) {
    caption = `all ${history.nodes} nodes`
    for (let node = 0; node < history.nodes; node++) {
      stroke(
        (each) => history.forEachNodeSample(node, each),
        seriesColor(node, history.nodes),
        1.2,
        0.85,
      )
    }
  } else if (frame.mode === 'sum' && history !== null) {
    caption = `sum of ${history.nodes} nodes`
    stroke(
      (each) =>
        history.forEachSample((time, read) => {
          let total = 0
          for (let node = 0; node < history.nodes; node++) total += read(node)
          each(time, total)
        }),
      COLORS.trace,
      1.8,
    )
  } else if (frame.mode === 'modal' && frame.modal !== null) {
    const { coordinates, shape, unavailable } = frame.modal
    if (unavailable !== null) {
      caption = unavailable
    } else {
      caption = `node ${frame.nodeIndex} = ${coordinates.nodes} harmonics`
      // Each mode's contribution to this node, faint...
      for (let mode = 0; mode < coordinates.nodes; mode++) {
        const phi = shape[mode] ?? 0
        stroke(
          (each) =>
            coordinates.forEachNodeSample(mode, (time, q) => each(time, phi * q)),
          seriesColor(mode, coordinates.nodes),
          1.1,
          0.7,
        )
      }
      // ...and their sum over the top, which is the node's own trace. Drawn
      // from the same coordinates rather than from the single-node buffer, so
      // the two agreeing is a result and not an assumption.
      //
      // In ink rather than the trace colour: the harmonics are drawn from the
      // series ramp, whose blue end would otherwise be mistaken for the sum.
      stroke(
        (each) =>
          coordinates.forEachSample((time, read) => {
            let total = 0
            for (let mode = 0; mode < coordinates.nodes; mode++) {
              total += (shape[mode] ?? 0) * read(mode)
            }
            each(time, total)
          }),
        COLORS.text,
        2,
      )
    }
  } else {
    stroke((each) => frame.buffer.forEach(each), COLORS.trace, 1.6)
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.muted
  ctx.font = '10px system-ui, sans-serif'
  ctx.fillText(
    `${caption}  ·  mm  ·  ${frame.window.toFixed(1)} s window`,
    PAD_LEFT + 4,
    height - 3,
  )
}
