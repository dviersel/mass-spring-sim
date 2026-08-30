/**
 * Shared palette and canvas helpers. Drawing units only -- never physics.
 *
 * The palette lives in the stylesheet, as custom properties, and is read from
 * there rather than duplicated here. One source of truth means the canvases and
 * the surrounding interface cannot drift apart across a theme change, and a
 * theme is added by editing CSS alone.
 *
 * COLORS is mutable and refreshed when the theme changes. Every drawing routine
 * reads it at paint time, so a refresh reaches the next frame with nothing to
 * subscribe to.
 */

export interface Palette {
  background: string
  panel: string
  grid: string
  axis: string
  text: string
  muted: string
  dim: string
  spring: string
  free: string
  driven: string
  force: string
  actuator: string
  modulation: string
  trace: string
  warn: string
  overlay: string
}

/** Dark values, used until the first refresh and if a property is ever missing. */
export const COLORS: Palette = {
  background: '#0d1117',
  panel: '#12171f',
  grid: '#1c2430',
  axis: '#2b3542',
  text: '#d5dde8',
  muted: '#7d8b9e',
  dim: '#4a5768',
  spring: '#6b7a8f',
  free: '#58a6ff',
  driven: '#f0883e',
  force: '#3fb950',
  actuator: '#bc8cff',
  modulation: '#f778ba',
  trace: '#58a6ff',
  warn: '#f85149',
  overlay: '#8b949e',
}

const CSS_VARIABLE: Record<keyof Palette, string> = {
  background: '--bg',
  panel: '--panel',
  grid: '--grid',
  axis: '--axis',
  text: '--text',
  muted: '--muted',
  dim: '--dim',
  spring: '--spring',
  free: '--free',
  driven: '--driven',
  force: '--force',
  actuator: '--actuator',
  modulation: '--modulation',
  trace: '--trace',
  warn: '--warn',
  overlay: '--overlay',
}

/** Series hues need more depth on a light ground and more lift on a dark one. */
let seriesLightness = '62%'

/** Re-read the palette from the stylesheet. Call after the theme changes. */
export function refreshPalette(): void {
  const computed = getComputedStyle(document.documentElement)
  for (const key of Object.keys(CSS_VARIABLE) as (keyof Palette)[]) {
    const value = computed.getPropertyValue(CSS_VARIABLE[key]).trim()
    if (value !== '') COLORS[key] = value
  }
  const lightness = computed.getPropertyValue('--series-lightness').trim()
  if (lightness !== '') seriesLightness = lightness
}

/**
 * The shared hue ramp, indexed by position in an ordered series.
 *
 * Used for the modal participation bars, indexed by mode, and for the
 * seismograph pens, indexed by node. Those are different quantities and there
 * are different numbers of them, so this is a shared palette family rather than
 * a claim that pen n corresponds to bar n.
 */
export function seriesColor(index: number, total: number): string {
  const hue = total <= 1 ? 200 : 200 + (index / total) * 200
  return `hsl(${hue % 360} 70% ${seriesLightness})`
}

export interface CanvasSurface {
  readonly ctx: CanvasRenderingContext2D
  readonly width: number
  readonly height: number
}

/**
 * Size a canvas to its CSS box at device pixel density and return a context
 * already scaled to CSS pixels, so all drawing code works in layout units.
 */
export function prepare(canvas: HTMLCanvasElement): CanvasSurface | null {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null

  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return null

  const targetWidth = Math.round(width * ratio)
  const targetHeight = Math.round(height * ratio)
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return { ctx, width, height }
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
