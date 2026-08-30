/** Shared palette and canvas helpers. Drawing units only -- never physics. */

export const COLORS = {
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
} as const

/** Distinct hues for the modal participation bars, cycling if there are more. */
export function modeColor(index: number, total: number): string {
  const hue = total <= 1 ? 200 : 200 + (index / total) * 200
  return `hsl(${hue % 360} 70% 62%)`
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
