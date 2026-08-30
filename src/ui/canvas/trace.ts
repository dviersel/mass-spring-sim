/**
 * Scrolling time trace of one node's displacement.
 *
 * Participation bars say which modes are ringing; this says how that changed
 * over time, which is what "watch resonance build and decay" actually looks
 * like. The horizontal axis is SIMULATED seconds, not wall-clock, so changing
 * the time scale slows the sweep without changing what the trace means.
 */

import { COLORS, prepare } from './theme'

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

export interface TraceFrame {
  readonly buffer: TraceBuffer
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

  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.muted
  ctx.font = '10px system-ui, sans-serif'
  ctx.fillText(`node ${frame.nodeIndex}  ·  mm  ·  ${frame.window.toFixed(1)} s window`, PAD_LEFT + 4, height - 3)

  const oldest = frame.now - frame.window
  ctx.strokeStyle = COLORS.trace
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.beginPath()
  let started = false
  frame.buffer.forEach((time, value) => {
    if (time < oldest) return
    const x = PAD_LEFT + ((time - oldest) / frame.window) * plotWidth
    const y = midY - Math.max(-1.6, Math.min(1.6, value / scale)) * halfHeight
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.stroke()
}
