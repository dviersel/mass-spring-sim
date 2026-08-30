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
import { COLORS, seriesColor, prepare, roundedRect } from './theme'

export interface ParticipationFrame {
  /** Peak nodal displacement each mode alone would produce, metres. */
  readonly amplitudes: Float64Array
  readonly modes: readonly ModeSummary[]
  /** Reference scale, metres. Smoothed by the caller so bars do not jitter. */
  readonly scale: number
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
  for (const fraction of [0, 0.5, 1]) {
    const y = baseline - fraction * plotHeight
    ctx.beginPath()
    ctx.moveTo(PAD_LEFT, y)
    ctx.lineTo(width - PAD_RIGHT, y)
    ctx.stroke()
    ctx.fillText(`${(fraction * frame.scale * 1000).toFixed(1)}`, PAD_LEFT - 6, y + 3)
  }

  ctx.save()
  ctx.translate(11, PAD_TOP + plotHeight / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.muted
  ctx.fillText('peak mm', 0, 0)
  ctx.restore()

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
    const fraction = frame.scale > 0 ? Math.min(1.15, value / frame.scale) : 0
    const barHeight = fraction * plotHeight

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
