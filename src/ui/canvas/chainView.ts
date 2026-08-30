/**
 * The chain animation.
 *
 * What a drawing means depends on the chain's motion regime, and the two must
 * not be conflated:
 *
 *  - In the TRANSVERSE regime the masses really do move across the axis, so
 *    drawing them offset perpendicular is a literal picture. Only that drawing
 *    is truthful, and the UI offers no other.
 *
 *  - In the LONGITUDINAL regime the masses move along the axis. Drawing them
 *    inline is the honest picture; drawing the same numbers perpendicular is a
 *    PLOT, chosen by default because standing waves are almost unreadable
 *    inline and immediately obvious offset. The caption says which it is.
 */

import type { ChainSpec } from '../../core/chain'
import { isSilent } from '../../core/signal'
import type { ViewSettings } from '../view'
import { COLORS, prepare } from './theme'
import { drawSeismographs, type NodeTraceBuffer } from './seismograph'

export interface ChainFrame {
  readonly spec: ChainSpec
  /** Displacement of every node, metres, indexed by node. */
  readonly displacements: Float64Array
  readonly view: ViewSettings
  /** Reference shape to overlay, one entry per node, already scaled to metres. */
  readonly overlay: Float64Array | null
  /** Per-node history for the seismograph pens, or null when not recording. */
  readonly history: NodeTraceBuffer | null
  /** Current simulated time, seconds. */
  readonly now: number
}

const PAD_X = 46
const PAD_Y = 26
/**
 * Room left under the spring for its node labels once it moves down to make
 * space for the traces.
 */
const SEISMOGRAPH_FOOT = 34

interface Layout {
  readonly axisPxPerMetre: number
  readonly displacementPxPerMetre: number
  readonly originX: number
  readonly axisY: number
  readonly span: number
}

/**
 * Whether the seismograph pens are drawn.
 *
 * They need the vertical axis for time, which the perpendicular drawing has
 * already spent on displacement -- so they belong to the inline drawing, where
 * a mass moves horizontally and the pen can deflect the same way it does.
 */
export function seismographActive(frame: ChainFrame): boolean {
  return frame.view.seismograph !== 'off' && !isPerpendicular(frame) && frame.history !== null
}

function isPerpendicular(frame: ChainFrame): boolean {
  return frame.spec.motionMode === 'transverse' || frame.view.orientation === 'perpendicular'
}

function layout(frame: ChainFrame, width: number, height: number): Layout {
  const nodes = frame.spec.nodes
  const first = nodes[0]?.position ?? 0
  const last = nodes[nodes.length - 1]?.position ?? 1
  const length = Math.max(1e-9, last - first)
  const span = width - 2 * PAD_X
  const axisPxPerMetre = span / length
  return {
    axisPxPerMetre,
    // Exaggeration is defined against the axis scale, so "60x" means literally
    // sixty times life size on this drawing.
    displacementPxPerMetre: axisPxPerMetre * frame.view.displacementExaggeration,
    originX: PAD_X,
    // With pens running, the spring sits low and hands the rest of the pane to
    // the traces; otherwise it takes the middle so displacement has room either
    // side of rest.
    axisY: seismographActive(frame)
      ? height - PAD_Y - SEISMOGRAPH_FOOT
      : height / 2,
    span,
  }
}

function axisX(frame: ChainFrame, l: Layout, nodeIndex: number): number {
  const nodes = frame.spec.nodes
  const first = nodes[0]?.position ?? 0
  return l.originX + ((nodes[nodeIndex]?.position ?? 0) - first) * l.axisPxPerMetre
}

export function drawChain(canvas: HTMLCanvasElement, frame: ChainFrame): void {
  const surface = prepare(canvas)
  if (surface === null) return
  const { ctx, width, height } = surface
  const l = layout(frame, width, height)

  ctx.fillStyle = COLORS.panel
  ctx.fillRect(0, 0, width, height)

  drawRestAxis(ctx, frame, l, width, height)

  // Pens first, so the chain itself is drawn over its own history rather than
  // under it.
  if (seismographActive(frame) && frame.history !== null) {
    drawSeismographs(ctx, {
      buffer: frame.history,
      now: frame.now,
      window: frame.view.traceWindow,
      nodeCount: frame.spec.nodes.length,
      restX: (i) => axisX(frame, l, i),
      displacementPxPerMetre: l.displacementPxPerMetre,
      baselineY: l.axisY,
      topY: PAD_Y,
      tracedNode: frame.view.tracedNode,
      mode: frame.view.seismograph,
    })
  }

  // Transverse masses genuinely move across the axis, so the inline drawing is
  // not merely less readable there -- it is wrong. Enforced here rather than
  // relying on the control being disabled, so no stale view setting can produce
  // a picture that misrepresents the physics.
  const perpendicular = isPerpendicular(frame)
  if (perpendicular) {
    drawPerpendicular(ctx, frame, l, height)
  } else {
    drawInline(ctx, frame, l, height)
  }
  drawSegmentDecorations(ctx, frame, l, height)
}

function drawRestAxis(
  ctx: CanvasRenderingContext2D,
  frame: ChainFrame,
  l: Layout,
  width: number,
  height: number,
): void {
  ctx.save()
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  ctx.setLineDash([3, 5])
  ctx.beginPath()
  ctx.moveTo(PAD_X - 12, l.axisY)
  ctx.lineTo(width - PAD_X + 12, l.axisY)
  ctx.stroke()
  ctx.restore()

  // With the pens running, the vertical guides are the pens' own baselines and
  // the labels belong under the spring rather than at the foot of the pane.
  if (seismographActive(frame)) {
    ctx.fillStyle = COLORS.dim
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    for (let i = 0; i < frame.spec.nodes.length; i++) {
      ctx.fillText(String(i), axisX(frame, l, i), l.axisY + 24)
    }
    ctx.textAlign = 'right'
    ctx.fillText('node', PAD_X - 10, l.axisY + 24)
    return
  }

  // A faint guide at every node's rest position. These connect the index
  // labels to the chain, and reading a standing wave off the plot is much
  // easier when you can see which node each crest sits on.
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  for (let i = 0; i < frame.spec.nodes.length; i++) {
    const x = axisX(frame, l, i)
    ctx.beginPath()
    ctx.moveTo(x, PAD_Y)
    ctx.lineTo(x, height - PAD_Y + 6)
    ctx.stroke()
  }

  ctx.fillStyle = COLORS.dim
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  for (let i = 0; i < frame.spec.nodes.length; i++) {
    ctx.fillText(String(i), axisX(frame, l, i), height - PAD_Y + 18)
  }
  ctx.textAlign = 'right'
  ctx.fillText('node', PAD_X - 10, height - PAD_Y + 18)
}

function nodeY(frame: ChainFrame, l: Layout, i: number): number {
  return l.axisY - (frame.displacements[i] as number) * l.displacementPxPerMetre
}

function drawPerpendicular(
  ctx: CanvasRenderingContext2D,
  frame: ChainFrame,
  l: Layout,
  height: number,
): void {
  const n = frame.spec.nodes.length

  if (frame.overlay !== null) {
    ctx.save()
    ctx.strokeStyle = COLORS.overlay
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const y = l.axisY - (frame.overlay[i] as number) * l.displacementPxPerMetre
      if (i === 0) ctx.moveTo(axisX(frame, l, i), y)
      else ctx.lineTo(axisX(frame, l, i), y)
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.strokeStyle = COLORS.spring
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = axisX(frame, l, i)
    const y = nodeY(frame, l, i)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  for (let i = 0; i < n; i++) {
    drawNode(ctx, frame, axisX(frame, l, i), nodeY(frame, l, i), i, height)
  }
}

function drawInline(
  ctx: CanvasRenderingContext2D,
  frame: ChainFrame,
  l: Layout,
  height: number,
): void {
  const n = frame.spec.nodes.length
  const positions: number[] = []
  for (let i = 0; i < n; i++) {
    positions.push(
      axisX(frame, l, i) + (frame.displacements[i] as number) * l.displacementPxPerMetre,
    )
  }

  // Coils between neighbours: bunching and stretching IS the signal here.
  ctx.strokeStyle = COLORS.spring
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  const coils = 6
  const amplitude = 9
  for (let i = 0; i < n - 1; i++) {
    const x0 = positions[i] as number
    const x1 = positions[i + 1] as number
    ctx.beginPath()
    ctx.moveTo(x0, l.axisY)
    const steps = coils * 4
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      const x = x0 + (x1 - x0) * t
      ctx.lineTo(x, l.axisY + Math.sin(t * coils * 2 * Math.PI) * amplitude)
    }
    ctx.lineTo(x1, l.axisY)
    ctx.stroke()
  }

  // The reference shape, as ghost positions along the axis. Drawn here as well
  // as in the perpendicular view, so selecting a mode overlay never silently
  // does nothing just because of which drawing is showing.
  if (frame.overlay !== null) {
    ctx.save()
    ctx.strokeStyle = COLORS.overlay
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.5
    for (let i = 0; i < n; i++) {
      const x = axisX(frame, l, i) + (frame.overlay[i] as number) * l.displacementPxPerMetre
      ctx.beginPath()
      ctx.arc(x, l.axisY, 8.5, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  for (let i = 0; i < n; i++) {
    drawNode(ctx, frame, positions[i] as number, l.axisY, i, height)
  }

  // Exaggerated far enough and neighbouring masses appear to pass through each
  // other, which no real spring does. The state is fine -- this is purely the
  // drawing -- but saying so is better than letting it read as a bug or, worse,
  // as physics.
  let crossed = false
  for (let i = 0; i < n - 1; i++) {
    if ((positions[i + 1] as number) < (positions[i] as number)) crossed = true
  }
  if (crossed) {
    ctx.fillStyle = COLORS.driven
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(
      `${frame.view.displacementExaggeration.toFixed(0)}× exaggeration exceeds the node spacing — apparent crossings are a drawing artefact`,
      PAD_X - 6,
      PAD_Y + 10,
    )
  }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  frame: ChainFrame,
  x: number,
  y: number,
  index: number,
  height: number,
): void {
  const node = frame.spec.nodes[index]
  if (node === undefined) return
  const traced = index === frame.view.tracedNode

  if (traced) {
    ctx.save()
    ctx.strokeStyle = COLORS.trace
    ctx.globalAlpha = 0.25
    ctx.lineWidth = 1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(x, PAD_Y - 10)
    ctx.lineTo(x, height - PAD_Y + 2)
    ctx.stroke()
    ctx.restore()
  }

  if (node.driven) {
    // Driven nodes are squares on a bracket: their position is imposed, not
    // solved for, and the shape should say so at a glance.
    ctx.fillStyle = COLORS.driven
    ctx.fillRect(x - 6, y - 6, 12, 12)
    ctx.strokeStyle = COLORS.background
    ctx.lineWidth = 1.5
    ctx.strokeRect(x - 6, y - 6, 12, 12)
    if (!isSilent(node.motion)) {
      ctx.strokeStyle = COLORS.driven
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  } else {
    ctx.fillStyle = COLORS.free
    ctx.beginPath()
    ctx.arc(x, y, 6.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = COLORS.background
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  if (!isSilent(node.force)) {
    // A force arrow, drawn only where a force can actually act.
    ctx.strokeStyle = COLORS.force
    ctx.fillStyle = COLORS.force
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x, y - 15)
    ctx.lineTo(x, y - 28)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y - 32)
    ctx.lineTo(x - 4, y - 24)
    ctx.lineTo(x + 4, y - 24)
    ctx.closePath()
    ctx.fill()
  }
}

function drawSegmentDecorations(
  ctx: CanvasRenderingContext2D,
  frame: ChainFrame,
  l: Layout,
  height: number,
): void {
  const y = height - PAD_Y - 6
  for (let i = 0; i < frame.spec.segments.length; i++) {
    const segment = frame.spec.segments[i]
    if (segment === undefined) continue
    const x0 = axisX(frame, l, i)
    const x1 = axisX(frame, l, i + 1)

    if (!isSilent(segment.actuator)) {
      ctx.strokeStyle = COLORS.actuator
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x0 + 4, y)
      ctx.lineTo(x1 - 4, y)
      ctx.moveTo(x0 + 4, y - 4)
      ctx.lineTo(x0 + 4, y + 4)
      ctx.moveTo(x1 - 4, y - 4)
      ctx.lineTo(x1 - 4, y + 4)
      ctx.stroke()
    }

    if (!isSilent(segment.stiffnessModulation)) {
      ctx.strokeStyle = COLORS.modulation
      ctx.lineWidth = 2
      ctx.beginPath()
      const steps = 24
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const x = x0 + (x1 - x0) * t
        const wave = y + 7 + Math.sin(t * 4 * Math.PI) * 3
        if (s === 0) ctx.moveTo(x, wave)
        else ctx.lineTo(x, wave)
      }
      ctx.stroke()
    }
  }
}
