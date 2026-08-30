/**
 * Per-node seismograph traces: one pen per mass, time running up the pane.
 *
 * Each trace is anchored at its node's rest position and deflects sideways by
 * that node's displacement, at the same scale the chain itself is drawn. The
 * pen really is at the mass, so a trace is a record of what that node did
 * rather than a separate plot with its own axis.
 *
 * Reading the array together is the point: a disturbance entering one end
 * appears as a diagonal sweeping across the traces, which is a travelling wave
 * seen directly. A standing wave instead shows every trace in step, with the
 * nodes of the mode staying flat.
 *
 * This pairs with the inline drawing, where displacement is already horizontal,
 * so the pen deflects the same way the mass moves. Perpendicular drawing spends
 * the vertical axis on displacement and has none left for time.
 */

import type { SeismographMode } from '../view'
import { COLORS, seriesColor } from './theme'

/**
 * Ring buffer of whole-chain snapshots.
 *
 * One flat array holds every node's history so a sample is a single contiguous
 * write per step, which matters because sampling happens at the integration
 * rate rather than once a frame.
 */
export class NodeTraceBuffer {
  private times: Float64Array
  private values: Float64Array
  private head = 0
  private count = 0

  constructor(
    private nodeCount: number,
    private readonly capacity = 1400,
  ) {
    this.times = new Float64Array(capacity)
    this.values = new Float64Array(capacity * Math.max(1, nodeCount))
  }

  get nodes(): number {
    return this.nodeCount
  }

  get size(): number {
    return this.count
  }

  /** Reallocates and clears when the chain changes size. */
  resize(nodeCount: number): void {
    if (nodeCount === this.nodeCount) return
    this.nodeCount = nodeCount
    this.values = new Float64Array(this.capacity * Math.max(1, nodeCount))
    this.clear()
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }

  push(time: number, displacements: Float64Array): void {
    this.times[this.head] = time
    this.values.set(
      displacements.subarray(0, this.nodeCount),
      this.head * this.nodeCount,
    )
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** Visits one node's history, oldest first. */
  forEachNodeSample(node: number, visit: (time: number, value: number) => void): void {
    if (node < 0 || node >= this.nodeCount) return
    const start = (this.head - this.count + this.capacity) % this.capacity
    for (let i = 0; i < this.count; i++) {
      const index = (start + i) % this.capacity
      visit(
        this.times[index] as number,
        this.values[index * this.nodeCount + node] as number,
      )
    }
  }

  /** Largest absolute displacement inside the window, across every node. */
  peakWithin(oldest: number): number {
    const start = (this.head - this.count + this.capacity) % this.capacity
    let peak = 0
    for (let i = 0; i < this.count; i++) {
      const index = (start + i) % this.capacity
      if ((this.times[index] as number) < oldest) continue
      const base = index * this.nodeCount
      for (let j = 0; j < this.nodeCount; j++) {
        peak = Math.max(peak, Math.abs(this.values[base + j] as number))
      }
    }
    return peak
  }
}

export interface SeismographFrame {
  readonly buffer: NodeTraceBuffer
  /** Current simulated time. The newest sample sits at the baseline. */
  readonly now: number
  /** Simulated seconds spanned by the pane. */
  readonly window: number
  readonly nodeCount: number
  /** Rest position of a node in canvas pixels. */
  readonly restX: (node: number) => number
  /** The same metres-to-pixels factor the chain is drawn with. */
  readonly displacementPxPerMetre: number
  /** Where the newest sample sits: the spring's own line. */
  readonly baselineY: number
  /** Where the oldest sample sits. */
  readonly topY: number
  readonly tracedNode: number
  readonly mode: SeismographMode
}

/**
 * Scratch for the plotted points, reused between frames.
 *
 * Every node shares the same sample times, so each trace yields the same number
 * of points and they can be laid out as one flat array. Holding them lets a
 * band be closed by walking its right-hand pen backwards, which the ring buffer
 * cannot do directly, and lets each pen be projected once rather than twice.
 */
let scratch = new Float64Array(0)
let scratchStride = 0

const TIME_GRID_TARGET = 6

export function drawSeismographs(ctx: CanvasRenderingContext2D, frame: SeismographFrame): void {
  const { baselineY, topY, now, window: seconds } = frame
  const span = baselineY - topY
  if (span <= 0 || seconds <= 0) return

  const oldest = now - seconds
  // Newest at the baseline, history drifting upward. The pen is at the mass:
  // the tip of every trace touches the node that drew it, so the chain and its
  // own record join up instead of the spring sitting against the oldest sample.
  const timeToY = (t: number): number => baselineY - ((now - t) / seconds) * span

  const samples = project(frame, timeToY, oldest)
  if (samples === 0) return

  drawTimeGrid(ctx, frame, timeToY, oldest)

  // Rest baselines first, so every pen has a visible zero to deflect from.
  ctx.save()
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  for (let i = 0; i < frame.nodeCount; i++) {
    const x = frame.restX(i)
    ctx.beginPath()
    ctx.moveTo(x, topY)
    ctx.lineTo(x, baselineY)
    ctx.stroke()
  }
  ctx.restore()

  drawScaleBar(ctx, frame)

  if (frame.mode === 'ribbon') drawBands(ctx, frame, samples)
  drawPens(ctx, frame, samples)
}

/**
 * Project every node's visible history into canvas points, returning the number
 * of samples plotted.
 */
function project(
  frame: SeismographFrame,
  timeToY: (t: number) => number,
  oldest: number,
): number {
  const { nodeCount } = frame
  let count = 0

  // Every node shares the sample times, so node zero settles the count.
  frame.buffer.forEachNodeSample(0, (t) => {
    if (t >= oldest) count++
  })
  if (count === 0) return 0

  const needed = nodeCount * count * 2
  if (scratch.length < needed) scratch = new Float64Array(needed)
  scratchStride = count * 2

  for (let i = 0; i < nodeCount; i++) {
    const restX = frame.restX(i)
    const base = i * scratchStride
    let k = 0
    frame.buffer.forEachNodeSample(i, (t, value) => {
      if (t < oldest || k >= count) return
      scratch[base + k * 2] = restX + value * frame.displacementPxPerMetre
      scratch[base + k * 2 + 1] = timeToY(t)
      k++
    })
  }
  return count
}

function pointX(node: number, index: number): number {
  return scratch[node * scratchStride + index * 2] as number
}

function pointY(node: number, index: number): number {
  return scratch[node * scratchStride + index * 2 + 1] as number
}

/**
 * Fill each gap between neighbouring pens with a gradient running from one
 * pen's colour to the next.
 *
 * Chained across the chain they read as one continuous surface, so a wave
 * travelling along it is a shape rather than eleven separate wiggles that have
 * to be correlated by eye. The gradient runs between the two nodes' REST
 * positions rather than their current ones, so the colours stay pinned to the
 * chain instead of sloshing about with the motion.
 */
function drawBands(ctx: CanvasRenderingContext2D, frame: SeismographFrame, samples: number): void {
  ctx.save()
  ctx.globalAlpha = 0.5
  for (let i = 0; i < frame.nodeCount - 1; i++) {
    const leftRest = frame.restX(i)
    const rightRest = frame.restX(i + 1)

    const gradient = ctx.createLinearGradient(leftRest, 0, rightRest, 0)
    gradient.addColorStop(0, seriesColor(i, frame.nodeCount))
    gradient.addColorStop(1, seriesColor(i + 1, frame.nodeCount))
    ctx.fillStyle = gradient

    ctx.beginPath()
    ctx.moveTo(pointX(i, 0), pointY(i, 0))
    for (let k = 1; k < samples; k++) ctx.lineTo(pointX(i, k), pointY(i, k))
    for (let k = samples - 1; k >= 0; k--) ctx.lineTo(pointX(i + 1, k), pointY(i + 1, k))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawPens(ctx: CanvasRenderingContext2D, frame: SeismographFrame, samples: number): void {
  const ribbon = frame.mode === 'ribbon'
  for (let i = 0; i < frame.nodeCount; i++) {
    const traced = i === frame.tracedNode
    ctx.save()
    // The same hue ramp the participation bars use, indexed by node here rather
    // than by mode. Nodes and modes are different quantities and there are
    // different numbers of them, so this is a shared palette family and not a
    // claim that pen n belongs to bar n. The selected pen is picked out by
    // weight and opacity rather than by hue, so it keeps its place in the ramp.
    ctx.strokeStyle = seriesColor(i, frame.nodeCount)
    ctx.globalAlpha = traced ? 1 : ribbon ? 0.85 : 0.62
    ctx.lineWidth = traced ? 2.2 : ribbon ? 1 : 1.2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(pointX(i, 0), pointY(i, 0))
    for (let k = 1; k < samples; k++) ctx.lineTo(pointX(i, k), pointY(i, k))
    ctx.stroke()
    ctx.restore()
  }
}

function drawTimeGrid(
  ctx: CanvasRenderingContext2D,
  frame: SeismographFrame,
  timeToY: (t: number) => number,
  oldest: number,
): void {
  // A round interval near the target count, so labels stay readable as the
  // window is changed.
  const raw = frame.window / TIME_GRID_TARGET
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10

  ctx.save()
  ctx.strokeStyle = COLORS.grid
  ctx.fillStyle = COLORS.dim
  ctx.lineWidth = 1
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'

  const first = Math.ceil(oldest / step) * step
  for (let t = first; t <= frame.now + 1e-9; t += step) {
    const y = timeToY(t)
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.moveTo(frame.restX(0) - 22, y)
    ctx.lineTo(frame.restX(frame.nodeCount - 1) + 22, y)
    ctx.stroke()
    ctx.globalAlpha = 1
    // Age rather than absolute time: what matters is how long ago, and an
    // absolute clock would scroll every label every frame.
    const age = frame.now - t
    ctx.fillText(age < step / 2 ? 'now' : `-${age.toFixed(age < 1 ? 2 : 1)}s`, 4, y - 3)
  }
  ctx.restore()
}

/**
 * A labelled bar showing what a round displacement looks like at the current
 * exaggeration.
 *
 * The pens deflect at the same scale the chain is drawn, which keeps them
 * honest against the animation but leaves them with no number on the axis. The
 * bar supplies one, and picks a round millimetre value wide enough to measure
 * against.
 */
function drawScaleBar(ctx: CanvasRenderingContext2D, frame: SeismographFrame): void {
  const perMetre = frame.displacementPxPerMetre
  if (!(perMetre > 0)) return

  const candidatesMm = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20]
  const chosen = candidatesMm.find((mm) => (mm / 1000) * perMetre >= 26) ?? candidatesMm[candidatesMm.length - 1] ?? 1
  const widthPx = (chosen / 1000) * perMetre

  const x = frame.restX(0)
  const y = frame.topY + 8

  ctx.save()
  ctx.strokeStyle = COLORS.dim
  ctx.fillStyle = COLORS.dim
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y + 4)
  ctx.lineTo(x, y)
  ctx.lineTo(x + widthPx, y)
  ctx.lineTo(x + widthPx, y + 4)
  ctx.stroke()
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'left'
  ctx.fillText(`${chosen} mm`, x + widthPx + 5, y + 3)
  ctx.restore()
}
