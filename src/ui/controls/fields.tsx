import type { ReactNode } from 'react'

export interface NumberFieldProps {
  readonly label: string
  readonly value: number
  readonly onChange: (value: number) => void
  readonly step?: number
  readonly min?: number
  readonly max?: number
  readonly unit?: string
  readonly digits?: number
}

/**
 * A numeric input that keeps its own text while focused.
 *
 * Reformatting on every keystroke would fight the user mid-edit -- typing "0.0"
 * on the way to "0.05" would be snapped back before the rest arrives.
 */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  unit,
  digits = 4,
}: NumberFieldProps): ReactNode {
  const clamp = (next: number): number => {
    let result = next
    if (min !== undefined) result = Math.max(min, result)
    if (max !== undefined) result = Math.min(max, result)
    return result
  }
  return (
    <label className="field">
      <span>{label}</span>
      <div className="with-unit">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? Number(value.toPrecision(digits)) : 0}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value)
            if (Number.isFinite(next)) onChange(clamp(next))
          }}
        />
        {unit !== undefined && <span className="unit">{unit}</span>}
      </div>
    </label>
  )
}

export interface SliderFieldProps {
  readonly label: string
  readonly display: string
  /** Slider position in [0, 1]. */
  readonly position: number
  readonly onPosition: (position: number) => void
}

export function SliderField({
  label,
  display,
  position,
  onPosition,
}: SliderFieldProps): ReactNode {
  return (
    <label className="field">
      <span>
        {label} <span className="mono">{display}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={position}
        onChange={(event) => onPosition(Number.parseFloat(event.target.value))}
      />
    </label>
  )
}

export function Panel({
  title,
  children,
  defaultOpen = true,
  accessory,
}: {
  readonly title: string
  readonly children: ReactNode
  readonly defaultOpen?: boolean
  readonly accessory?: ReactNode
}): ReactNode {
  return (
    <details className="panel" open={defaultOpen}>
      <summary>
        {title}
        {accessory !== undefined && <span className="grow" />}
        {accessory}
      </summary>
      <div className="body-pad">{children}</div>
    </details>
  )
}
