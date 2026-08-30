import type { ReactNode } from 'react'
import { type SignalSpec, chirp, sine, step } from '../../core/signal'
import { NumberField } from './fields'

/**
 * Editor for one driving signal.
 *
 * The four kinds are exactly those with an exact closed-form derivative, which
 * is a hard requirement rather than a convenience: the dashpots need the
 * velocity of an imposed motion and RK4 asks for it at intermediate times.
 * There is deliberately no noise option -- it has no analytical derivative.
 *
 * `unitScale` converts SI to whatever the user should see: millimetres for a
 * displacement, newtons for a force, percent for a stiffness modulation.
 */
export interface SignalEditorProps {
  readonly value: SignalSpec
  readonly onChange: (next: SignalSpec) => void
  readonly unitScale: number
  readonly unitLabel: string
  readonly amplitudeStep: number
  /** Current simulated time, so a sweep or ramp can be armed to start now. */
  readonly now: number
}

export function SignalEditor({
  value,
  onChange,
  unitScale,
  unitLabel,
  amplitudeStep,
  now,
}: SignalEditorProps): ReactNode {
  const amplitude = 'amplitude' in value ? value.amplitude : 0

  const changeKind = (kind: SignalSpec['kind']): void => {
    const carried = amplitude === 0 ? amplitudeStep / unitScale : amplitude
    switch (kind) {
      case 'off':
        onChange({ kind: 'off' })
        return
      case 'sine':
        onChange(sine(carried, 10))
        return
      case 'chirp':
        onChange(chirp(carried, 3, 50, 45, now))
        return
      case 'step':
        onChange(step(carried, now, 0.05))
        return
    }
  }

  return (
    <div className="row wrap" style={{ gap: 7, alignItems: 'flex-end' }}>
      <label className="field" style={{ maxWidth: 96 }}>
        <span>signal</span>
        <select
          value={value.kind}
          onChange={(event) => changeKind(event.target.value as SignalSpec['kind'])}
        >
          <option value="off">off</option>
          <option value="sine">sine</option>
          <option value="chirp">chirp</option>
          <option value="step">step</option>
        </select>
      </label>

      {value.kind !== 'off' && (
        <NumberField
          label="amplitude"
          unit={unitLabel}
          step={amplitudeStep}
          value={value.amplitude * unitScale}
          onChange={(next) => onChange({ ...value, amplitude: next / unitScale })}
        />
      )}

      {value.kind === 'sine' && (
        <>
          <NumberField
            label="frequency"
            unit="Hz"
            step={0.5}
            min={0}
            value={value.frequency}
            onChange={(frequency) => onChange({ ...value, frequency })}
          />
          <NumberField
            label="phase"
            unit="rad"
            step={0.1}
            value={value.phase}
            onChange={(phase) => onChange({ ...value, phase })}
          />
        </>
      )}

      {value.kind === 'chirp' && (
        <>
          <NumberField
            label="from"
            unit="Hz"
            step={1}
            min={0}
            value={value.startFrequency}
            onChange={(startFrequency) => onChange({ ...value, startFrequency })}
          />
          <NumberField
            label="to"
            unit="Hz"
            step={1}
            min={0}
            value={value.endFrequency}
            onChange={(endFrequency) => onChange({ ...value, endFrequency })}
          />
          <NumberField
            label="sweep"
            unit="s"
            step={5}
            min={0}
            value={value.duration}
            onChange={(duration) => onChange({ ...value, duration })}
          />
          <button
            type="button"
            className="tiny"
            title="Restart the sweep from the current simulated time"
            onClick={() => onChange({ ...value, startTime: now })}
          >
            restart sweep
          </button>
        </>
      )}

      {value.kind === 'step' && (
        <>
          <NumberField
            label="rise"
            unit="s"
            step={0.01}
            min={0.001}
            value={value.riseTime}
            onChange={(riseTime) => onChange({ ...value, riseTime })}
          />
          <button
            type="button"
            className="tiny"
            title="Re-trigger the ramp from the current simulated time"
            onClick={() => onChange({ ...value, startTime: now })}
          >
            re-trigger
          </button>
        </>
      )}

      {value.kind === 'step' && (
        <div className="seg-note">
          Ramped with a raised cosine, so both the displacement and its velocity
          stay continuous. A zero rise time would be an infinite velocity through
          the dashpots.
        </div>
      )}
    </div>
  )
}
