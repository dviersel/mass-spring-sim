import { useState, type ReactNode } from 'react'

export interface NumberFieldProps {
  readonly label: string
  readonly value: number
  readonly onChange: (value: number) => void
  readonly step?: number
  readonly min?: number
  readonly max?: number
  readonly unit?: string
  readonly digits?: number
  /**
   * When the value reaches `onChange`.
   *
   * `change`, the default, commits every keystroke, which is what makes
   * dragging stiffness or damping retune the chain as you go.
   *
   * `blur` holds the text until the field is left or Enter is pressed. Use it
   * where a half-typed number is destructive rather than merely wrong: typing
   * "21" over "11" passes through 2, and a control that rebuilds the chain acts
   * on that 2 -- collapsing to a chain with no interior nodes and discarding
   * every per-node mass before the real value arrives.
   */
  readonly commitOn?: 'change' | 'blur'
}

/**
 * A numeric input.
 *
 * Under `commitOn="blur"` it keeps its own text while focused, because
 * reformatting on every keystroke fights the user mid-edit -- typing "0.0" on
 * the way to "0.05" would be clamped and snapped back before the rest arrives.
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
  commitOn = 'change',
}: NumberFieldProps): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)

  const clamp = (next: number): number => {
    let result = next
    if (min !== undefined) result = Math.max(min, result)
    if (max !== undefined) result = Math.min(max, result)
    return result
  }
  const commit = (text: string): void => {
    const next = Number.parseFloat(text)
    // An unparseable draft reverts rather than committing a guess.
    if (Number.isFinite(next)) onChange(clamp(next))
    setDraft(null)
  }

  const formatted = Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '0'

  return (
    <label className="field">
      <span>{label}</span>
      <div className="with-unit">
        <input
          type="number"
          step={step}
          value={draft ?? formatted}
          onChange={(event) => {
            if (commitOn === 'blur') {
              setDraft(event.target.value)
              return
            }
            const next = Number.parseFloat(event.target.value)
            if (Number.isFinite(next)) onChange(clamp(next))
          }}
          onBlur={(event) => {
            if (commitOn === 'blur') commit(event.target.value)
          }}
          onKeyDown={(event) => {
            if (commitOn === 'blur' && event.key === 'Enter') commit(event.currentTarget.value)
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
