/**
 * Modal participation bars: how much of each mode is currently ringing.
 *
 * This is the readout that answers "which excitation mechanisms couple into
 * which modes". Drive an actuator inside one segment and some bars simply never
 * move, however hard you push -- that silence is the interesting part, so the
 * scale is shared across bars and a dark bar is drawn as genuinely dark rather
 * than being normalised up into visibility.
 */

import type { ModeSummary } from '../../core/eigen/modal'
import type { ParticipationScale } from '../view'
import { COLORS, seriesColor, prepare, roundedRect } from './theme'

/**
 * Decades shown below the peak on a logarithmic scale.
 *
 * Four is chosen to sit between the two things that must stay distinguishable.
 * A mode that is merely small during a sweep runs one to three decades down and
 * has to be visible; a mode that is structurally blocked comes out at rounding
 * level, nine or more decades down, and has to stay at exactly nothing.
 */
const DECADES = 4

/**
 * Height of a bar as a fraction of the plot, in [0, 1].
 *
 * On a linear scale this is just the ratio. On a logarithmic one, anything at
 * or below `peak / 10^DECADES` -- including a genuine zero -- returns exactly
 * zero, so a blocked mode still reads as blocked rather than as a short bar.
 */
export function barFraction(value: number, peak: number, scale: ParticipationScale): number {
  if (!(peak > 0) || !(value > 0)) return 0
  if (scale === 'linear') return Math.min(1.15, value / peak)
  const decadesDown = Math.log10(peak / value)
  if (decadesDown >= DECADES) return 0
  return Math.min(1, 1 - decadesDown / DECADES)
}

export interface ParticipationFrame {
  /** Peak nodal displacement each mode alone would produce, metres. */
  readonly amplitudes: Float64Array
  readonly modes: readonly ModeSummary[]
  /** Reference scale, metres. Smoothed by the caller so bars do not jitter. */
  readonly scale: number
  readonly scaleMode: ParticipationScale
  /** Greyed out when stiffness is time-varying and modal analysis is invalid. */
  readonly stale: boolean
}

const PAD_LEFT = 34
const PAD_RIGHT = 10
const PAD_TOP = 14
const PAD_BOTTOM = 26

export function drawParticipation(
  canvas: HTMLCanvasElement,
  frame: ParticipationFrame,
): void {
  const surface = prepare(canvas)
  if (surface === null) return
  const { ctx, width, height } = surface

  ctx.fillStyle = COLORS.panel
  ctx.fillRect(0, 0, width, height)

  const count = frame.amplitudes.length
  const plotWidth = width - PAD_LEFT - PAD_RIGHT
  const plotHeight = height - PAD_TOP - PAD_BOTTOM
  const baseline = PAD_TOP + plotHeight

  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  ctx.fillStyle = COLORS.dim
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'right'
  const gridFractions = frame.scaleMode === 'log' ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]
  for (const fraction of gridFractions) {
    const y = baseline - fraction * plotHeight
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, y)
    ctx.lineTo(width - PAD_RIGHT, y)
    ctx.stroke()
    // Every gridline carries its own value in millimetres, so a decade scale
    // stays readable as a measurement rather than only as a ranking.
    const millimetres =
      frame.scaleMode === 'log'
        ? frame.scale * 1000 * Math.pow(10, -DECADES * (1 - fraction))
        : fraction * frame.scale * 1000
    ctx.fillText(formatMillimetres(millimetres), PAD_LEFT - 6, y + 3)
  }

  ctx.save()
  ctx.translate(11, PAD_TOP + plotHeight / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.muted
  ctx.fillText(frame.scaleMode === 'log' ? 'peak mm, log' : 'peak mm', 0, 0)
  ctx.restore()

  // The regime warning lives in a banner at the top of the sidebar, which
  // scrolls away. Greyed bars alone are easy to miss, so the pane says for
  // itself that its numbers no longer describe the running system.
  if (frame.stale) {
    ctx.save()
    ctx.fillStyle = COLORS.warn
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'left'
    ctx.fillText('frozen · K is time-varying', PAD_LEFT + 2, PAD_TOP - 4)
    ctx.restore()
  }

  if (count === 0) {
    ctx.fillStyle = COLORS.muted
    ctx.textAlign = 'center'
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText('no free nodes', width / 2, height / 2)
    return
  }

  const slot = plotWidth / count
  const barWidth = Math.max(3, Math.min(28, slot * 0.62))
  ctx.globalAlpha = frame.stale ? 0.32 : 1

  for (let r = 0; r < count; r++) {
    const centre = PAD_LEFT + slot * (r + 0.5)
    const value = frame.amplitudes[r] as number
    const barHeight = barFraction(value, frame.scale, frame.scaleMode) * plotHeight

    ctx.fillStyle = COLORS.grid
    roundedRect(ctx, centre - barWidth / 2, PAD_TOP, barWidth, plotHeight, 3)
    ctx.fill()

    if (barHeight > 0.5) {
      ctx.fillStyle = seriesColor(r, count)
      roundedRect(ctx, centre - barWidth / 2, baseline - barHeight, barWidth, barHeight, 3)
      ctx.fill()
    }

    ctx.fillStyle = COLORS.muted
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(String(r + 1), centre, height - PAD_BOTTOM + 13)

    const mode = frame.modes[r]
    if (mode !== undefined && slot > 26) {
      ctx.fillStyle = COLORS.dim
      ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillText(`${mode.frequencyHz.toFixed(0)}`, centre, height - PAD_BOTTOM + 23)
    }
  }

  // Name the axis. These bars are indexed by MODE and there is one per degree
  // of freedom, whereas the seismograph pens are indexed by NODE and there is
  // one per node -- different quantities, different counts. They share a hue
  // ramp, which makes saying so worth the two words.
  ctx.fillStyle = COLORS.dim
  ctx.textAlign = 'right'
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText('mode', PAD_LEFT - 6, height - PAD_BOTTOM + 13)
  ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText('Hz', PAD_LEFT - 6, height - PAD_BOTTOM + 23)

  ctx.globalAlpha = 1
}

/**
 * Which bar sits under a point, or null if none does.
 *
 * Shares the layout constants above rather than re-deriving them, so the hit
 * target cannot drift away from what is drawn. `x` is in CSS pixels relative to
 * the canvas, which is what a bounding-rect offset gives.
 */
export function barAt(x: number, width: number, count: number): number | null {
  if (count <= 0) return null
  const plotWidth = width - PAD_LEFT - PAD_RIGHT
  if (plotWidth <= 0) return null

  const slot = plotWidth / count
  const index = Math.floor((x - PAD_LEFT) / slot)
  if (index < 0 || index >= count) return null
  return index
}

function formatMillimetres(value: number): string {
  if (value === 0) return '0'
  if (value >= 1) return value.toFixed(1)
  if (value >= 0.01) return value.toFixed(2)
  return value.toExponential(0)
}
