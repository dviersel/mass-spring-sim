import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  hasTimeVaryingStiffness,
  segmentDamping,
  segmentLength,
  segmentStiffness,
  type ChainSpec,
} from '../core/chain'
import {
  moveNode,
  resizeChain,
  respaceEvenly,
  setNodeDriven,
  setNodeForce,
  setNodeMass,
  setNodeMotion,
  setSegmentActuator,
  setSegmentStiffnessModulation,
  setTotals,
  silenceExcitations,
} from '../core/edit'
import { isSilent } from '../core/signal'
import { Runner, type RunnerStats } from './runner'
import { PRESETS, defaultChain } from './presets'
import {
  DEFAULT_VIEW,
  EXAGGERATION_RANGE,
  TIME_SCALE_RANGE,
  fromLogSlider,
  toLogSlider,
  type ViewSettings,
} from './view'
import { NumberField, Panel, SliderField } from './controls/fields'
import { SignalEditor } from './controls/SignalEditor'

interface PendingAction {
  readonly startMode?: { readonly mode: number; readonly amplitude: number } | undefined
}

export function App(): ReactNode {
  const [spec, setSpec] = useState<ChainSpec>(defaultChain)
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW)
  const [running, setRunning] = useState(true)
  const [stats, setStats] = useState<RunnerStats | null>(null)
  const [selectedNode, setSelectedNode] = useState(5)
  const [selectedSegment, setSelectedSegment] = useState(2)
  const [modeAmplitude, setModeAmplitude] = useState(0.003)
  const [silenceOnModeStart, setSilenceOnModeStart] = useState(true)
  const [activePreset, setActivePreset] = useState<string | null>(null)

  const chainCanvas = useRef<HTMLCanvasElement | null>(null)
  const participationCanvas = useRef<HTMLCanvasElement | null>(null)
  const traceCanvas = useRef<HTMLCanvasElement | null>(null)
  const runnerRef = useRef<Runner | null>(null)
  const pending = useRef<PendingAction | null>(null)

  useEffect(() => {
    const runner = new Runner(
      defaultChain(),
      DEFAULT_VIEW,
      {
        chain: chainCanvas.current,
        participation: participationCanvas.current,
        trace: traceCanvas.current,
      },
      setStats,
    )
    runnerRef.current = runner
    runner.emitStats()
    runner.start()
    return () => {
      runner.stop()
      if (runnerRef.current === runner) runnerRef.current = null
    }
  }, [])

  // Live editing: push the new chain in without resetting, so the chain keeps
  // moving through the change. A pending action from a preset is consumed here,
  // after the new chain is in place.
  useEffect(() => {
    const runner = runnerRef.current
    if (runner === null) return
    runner.setChain(spec)
    const action = pending.current
    pending.current = null
    if (action !== undefined && action !== null) {
      runner.reset()
      if (action.startMode !== undefined) {
        runner.startFromMode(action.startMode.mode, action.startMode.amplitude)
      }
    }
    runner.emitStats()
  }, [spec])

  useEffect(() => {
    runnerRef.current?.setView(view)
  }, [view])

  useEffect(() => {
    runnerRef.current?.setRunning(running)
  }, [running])

  useEffect(() => {
    runnerRef.current?.setOverlayMode(view.overlayMode, modeAmplitude)
  }, [view.overlayMode, modeAmplitude, spec])

  const now = stats?.time ?? 0
  const timeVarying = useMemo(() => hasTimeVaryingStiffness(spec), [spec])

  const patchView = useCallback((patch: Partial<ViewSettings>) => {
    setView((current) => ({ ...current, ...patch }))
  }, [])

  const applyPreset = useCallback((id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (preset === undefined) return
    const state = preset.build()
    pending.current = { startMode: state.startMode }
    setActivePreset(id)
    setView((current) => ({ ...DEFAULT_VIEW, ...current, ...state.view }))
    setSpec(state.spec)
  }, [])

  const startFromMode = useCallback(
    (mode: number) => {
      const runner = runnerRef.current
      if (runner === null) return
      if (silenceOnModeStart) {
        // Releasing a mode into a chain that is still being driven measures
        // nothing: the point is to watch one mode ring down on its own.
        pending.current = { startMode: { mode, amplitude: modeAmplitude } }
        setSpec((current) => silenceExcitations(current))
      } else {
        runner.reset()
        runner.startFromMode(mode, modeAmplitude)
      }
    },
    [modeAmplitude, silenceOnModeStart],
  )

  const node = spec.nodes[selectedNode]
  const segment = spec.segments[selectedSegment]

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Damped mass–spring chain</h1>
          <div className="sub">
            {spec.nodes.length} nodes · {spec.segments.length} segments · one continuous spring
          </div>
        </div>

        <div className="spacer" />

        <Stat label="dof" value={String(stats?.dof ?? 0)} />
        <Stat label="sim time" value={`${now.toFixed(2)} s`} />
        <Stat label="Δt" value={`${((stats?.timestep ?? 0) * 1e6).toFixed(0)} µs`} />
        <Stat label="steps/frame" value={String(stats?.stepsLastFrame ?? 0)} />
        <Stat label="energy" value={`${((stats?.energy ?? 0) * 1e6).toFixed(1)} µJ`} />

        <button type="button" className="primary" onClick={() => setRunning((r) => !r)}>
          {running ? '❙❙ pause' : '▶ run'}
        </button>
        <button
          type="button"
          onClick={() => {
            pending.current = {}
            setSpec((current) => ({ ...current }))
          }}
        >
          reset
        </button>
      </header>

      <div className="body">
        <div className="main">
          <div className="canvas-wrap chain-canvas">
            <canvas ref={chainCanvas} />
            <div className="caption">
              {view.orientation === 'transverse'
                ? 'transverse plot — displacement is longitudinal, drawn perpendicular for legibility'
                : 'longitudinal view — true motion, along the spring axis'}
            </div>
          </div>
          <div className="bottom">
            <div className="canvas-wrap short-canvas">
              <canvas ref={participationCanvas} />
              <div className="caption right">modal participation</div>
            </div>
            <div className="canvas-wrap short-canvas">
              <canvas ref={traceCanvas} />
              <div className="caption right">time trace</div>
            </div>
          </div>
        </div>

        <aside className="sidebar">
          {timeVarying && (
            <div className="banner warn">
              <span className="icon">⚠</span>
              <div>
                <strong>Time-varying stiffness is active.</strong> K changes as the
                simulation runs, so the mode shapes and frequencies below no longer
                describe this system. They are frozen at nominal stiffness and shown
                only as a reference — read parametric growth against them, do not
                trust them as current.
              </div>
            </div>
          )}

          {stats !== null && !stats.classicallyDamped && !timeVarying && (
            <div className="banner info">
              <span className="icon">ℹ</span>
              <div>
                Damping is non-proportional (
                <span className="mono">{stats.nonProportionality.toFixed(3)}</span>). The
                damping ratios are still exact — they come from the state-space
                spectrum — but the real mode shapes drawn here are an approximation of
                the true complex ones.
              </div>
            </div>
          )}

          <Panel title="Scenarios">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset${activePreset === preset.id ? ' primary' : ''}`}
                  onClick={() => applyPreset(preset.id)}
                >
                  <span className="name">{preset.name}</span>
                  <span className="hint">{preset.hint}</span>
                </button>
              ))}
            </div>
          </Panel>

          <ModeTable
            stats={stats}
            stale={timeVarying}
            amplitude={modeAmplitude}
            onAmplitude={setModeAmplitude}
            silence={silenceOnModeStart}
            onSilence={setSilenceOnModeStart}
            overlay={view.overlayMode}
            onOverlay={(mode) => patchView({ overlayMode: mode })}
            onStart={startFromMode}
          />

          <Panel title="View">
            <div className="hint-text">
              Drawing only. Neither control touches the physics: real displacements
              here are millimetres and real frequencies are tens of hertz.
            </div>
            <SliderField
              label="time scale"
              display={`${view.timeScale.toFixed(3)}× real time`}
              position={toLogSlider(view.timeScale, TIME_SCALE_RANGE)}
              onPosition={(t) => patchView({ timeScale: fromLogSlider(t, TIME_SCALE_RANGE) })}
            />
            <SliderField
              label="displacement exaggeration"
              display={`${view.displacementExaggeration.toFixed(0)}× life size`}
              position={toLogSlider(view.displacementExaggeration, EXAGGERATION_RANGE)}
              onPosition={(t) =>
                patchView({ displacementExaggeration: fromLogSlider(t, EXAGGERATION_RANGE) })
              }
            />
            <div className="row">
              <label className="field">
                <span>orientation</span>
                <select
                  value={view.orientation}
                  onChange={(e) =>
                    patchView({ orientation: e.target.value as ViewSettings['orientation'] })
                  }
                >
                  <option value="transverse">transverse plot</option>
                  <option value="longitudinal">longitudinal (true)</option>
                </select>
              </label>
              <label className="field">
                <span>traced node</span>
                <select
                  value={view.tracedNode}
                  onChange={(e) => patchView({ tracedNode: Number(e.target.value) })}
                >
                  {spec.nodes.map((_, i) => (
                    <option key={i} value={i}>
                      node {i}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="trace window"
                unit="s"
                step={0.25}
                min={0.1}
                value={view.traceWindow}
                onChange={(traceWindow) => patchView({ traceWindow })}
              />
            </div>
          </Panel>

          <Panel title="Spring">
            <div className="row">
              <NumberField
                label="total stiffness"
                unit="N/m"
                step={10}
                min={0.1}
                value={spec.totalStiffness}
                onChange={(totalStiffness) =>
                  setSpec((s) => setTotals(s, { totalStiffness }))
                }
              />
              <NumberField
                label="total damping"
                unit="N·s/m"
                step={0.01}
                min={0}
                value={spec.totalDamping}
                onChange={(totalDamping) => setSpec((s) => setTotals(s, { totalDamping }))}
              />
            </div>
            <div className="hint-text">
              Both are end-to-end properties of the whole spring. Each segment gets
              <span className="mono"> k·L/Lᵢ</span> and <span className="mono">c·L/Lᵢ</span>,
              so a short segment is stiffer and more damped in the same proportion —
              they are pieces of one spring, not ten independent ones.
            </div>
            <div className="row">
              <NumberField
                label="nodes"
                step={1}
                min={2}
                max={41}
                digits={2}
                value={spec.nodes.length}
                onChange={(count) => {
                  setSelectedNode(0)
                  setSelectedSegment(0)
                  setActivePreset(null)
                  setSpec((s) => resizeChain(s, count))
                }}
              />
              <div className="hint-text grow">
                Nothing here assumes nine masses — the degree-of-freedom count is
                derived from the chain. Set this to 3 for the simplest case: one
                free mass between two driven ones.
              </div>
            </div>
            <div className="row">
              <button type="button" onClick={() => setSpec(respaceEvenly)}>
                space nodes evenly
              </button>
              <button type="button" onClick={() => setSpec(silenceExcitations)}>
                silence all excitation
              </button>
            </div>
          </Panel>

          <Panel title="Nodes">
            <div className="chips">
              {spec.nodes.map((n, i) => (
                <button
                  key={i}
                  type="button"
                  className={`chip ${n.driven ? 'driven' : 'free'}${
                    i === selectedNode ? ' selected' : ''
                  }`}
                  onClick={() => setSelectedNode(i)}
                  title={n.driven ? 'driven — motion prescribed' : 'free — an unknown'}
                >
                  {i}
                  <span className="marks">
                    {!isSilent(n.motion) && (
                      <span className="mark" style={{ background: 'var(--driven)' }} />
                    )}
                    {!isSilent(n.force) && (
                      <span className="mark" style={{ background: 'var(--force)' }} />
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="legend">
              <span className="item">
                <span className="swatch" style={{ background: 'var(--free)' }} /> free
              </span>
              <span className="item">
                <span className="swatch" style={{ background: 'var(--driven)' }} /> driven
              </span>
              <span className="item">
                <span className="swatch" style={{ background: 'var(--force)' }} /> force
              </span>
            </div>

            {node !== undefined && (
              <>
                <div className="row">
                  <button
                    type="button"
                    onClick={() => setSpec((s) => setNodeDriven(s, selectedNode, !node.driven))}
                  >
                    {node.driven ? 'make free' : 'make driven'}
                  </button>
                  <NumberField
                    label="mass"
                    unit="kg"
                    step={0.01}
                    min={0.0001}
                    value={node.mass}
                    onChange={(mass) => setSpec((s) => setNodeMass(s, selectedNode, mass))}
                  />
                  {selectedNode > 0 && selectedNode < spec.nodes.length - 1 && (
                    <NumberField
                      label="position"
                      unit="m"
                      step={0.01}
                      value={node.position}
                      onChange={(position) =>
                        setSpec((s) => moveNode(s, selectedNode, position))
                      }
                    />
                  )}
                </div>

                <div className="hint-text">
                  {node.driven
                    ? 'Driven: this node follows a prescribed motion and is not an unknown. Being an end node is not what makes it driven — any node can be, and driving an interior one splits the chain in two.'
                    : 'Free: this node is an unknown of the system and can carry an external force.'}
                </div>

                {node.driven ? (
                  <SignalEditor
                    value={node.motion}
                    onChange={(motion) => setSpec((s) => setNodeMotion(s, selectedNode, motion))}
                    unitScale={1000}
                    unitLabel="mm"
                    amplitudeStep={0.1}
                    now={now}
                  />
                ) : (
                  <SignalEditor
                    value={node.force}
                    onChange={(force) => setSpec((s) => setNodeForce(s, selectedNode, force))}
                    unitScale={1}
                    unitLabel="N"
                    amplitudeStep={0.05}
                    now={now}
                  />
                )}
              </>
            )}
          </Panel>

          <Panel title="Segments">
            <div className="chips">
              {spec.segments.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className={`chip${i === selectedSegment ? ' selected' : ''}`}
                  onClick={() => setSelectedSegment(i)}
                >
                  {i}
                  <span className="marks">
                    {!isSilent(s.actuator) && (
                      <span className="mark" style={{ background: 'var(--actuator)' }} />
                    )}
                    {!isSilent(s.stiffnessModulation) && (
                      <span className="mark" style={{ background: 'var(--modulation)' }} />
                    )}
                  </span>
                </button>
              ))}
            </div>

            {segment !== undefined && (
              <>
                <div className="seg-note">
                  segment {selectedSegment} joins nodes {selectedSegment}–{selectedSegment + 1} ·
                  length <span className="mono">{(segmentLength(spec, selectedSegment) * 1000).toFixed(0)} mm</span> ·
                  k <span className="mono">{segmentStiffness(spec, selectedSegment).toFixed(0)} N/m</span> ·
                  c <span className="mono">{segmentDamping(spec, selectedSegment).toFixed(3)} N·s/m</span>
                </div>

                <div>
                  <div className="hint-text" style={{ marginBottom: 4 }}>
                    <strong style={{ color: 'var(--actuator)' }}>Actuator</strong> — modulates
                    this segment's own rest length, like a turnbuckle winding in and out. It
                    pushes its two end nodes apart, and a mode feels it only through its own
                    stretch across this segment.
                  </div>
                  <SignalEditor
                    value={segment.actuator}
                    onChange={(actuator) =>
                      setSpec((s) => setSegmentActuator(s, selectedSegment, actuator))
                    }
                    unitScale={1000}
                    unitLabel="mm"
                    amplitudeStep={0.1}
                    now={now}
                  />
                </div>

                <div>
                  <div className="hint-text" style={{ marginBottom: 4 }}>
                    <strong style={{ color: 'var(--modulation)' }}>Stiffness modulation</strong> —
                    scales this segment's k as <span className="mono">k·(1 + s(t))</span>.
                    <span className="warn-text"> This changes K itself and invalidates modal
                    analysis</span>, so it is a separate regime rather than another entry in the
                    force vector.
                  </div>
                  <SignalEditor
                    value={segment.stiffnessModulation}
                    onChange={(stiffnessModulation) =>
                      setSpec((s) =>
                        setSegmentStiffnessModulation(s, selectedSegment, stiffnessModulation),
                      )
                    }
                    unitScale={100}
                    unitLabel="%"
                    amplitudeStep={5}
                    now={now}
                  />
                </div>
              </>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  )
}

function ModeTable({
  stats,
  stale,
  amplitude,
  onAmplitude,
  silence,
  onSilence,
  overlay,
  onOverlay,
  onStart,
}: {
  readonly stats: RunnerStats | null
  readonly stale: boolean
  readonly amplitude: number
  readonly onAmplitude: (value: number) => void
  readonly silence: boolean
  readonly onSilence: (value: boolean) => void
  readonly overlay: number | null
  readonly onOverlay: (mode: number | null) => void
  readonly onStart: (mode: number) => void
}): ReactNode {
  const modes = stats?.modes ?? []
  return (
    <Panel title={stale ? 'Modes (frozen — see warning)' : 'Modes'}>
      <table className={`modes${stale ? ' stale' : ''}`}>
        <thead>
          <tr>
            <th>#</th>
            <th>f</th>
            <th>f damped</th>
            <th>ζ</th>
            <th>decay</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {modes.map((mode) => (
            <tr key={mode.index}>
              <td>{mode.index + 1}</td>
              <td>{mode.frequencyHz.toFixed(2)}</td>
              <td className={mode.oscillatory ? '' : 'overdamped'}>
                {mode.oscillatory ? mode.dampedFrequencyHz.toFixed(2) : '—'}
              </td>
              <td className={mode.oscillatory ? '' : 'overdamped'}>{mode.zeta.toFixed(4)}</td>
              <td>
                {Number.isFinite(mode.decayTime) ? `${mode.decayTime.toFixed(2)}s` : '∞'}
              </td>
              <td>
                <button
                  type="button"
                  className="tiny ghost"
                  title="Overlay this mode shape as a dashed reference"
                  onClick={() => onOverlay(overlay === mode.index + 1 ? null : mode.index + 1)}
                  style={overlay === mode.index + 1 ? { color: 'var(--free)' } : undefined}
                >
                  ◠
                </button>
              </td>
              <td>
                <button
                  type="button"
                  className="tiny"
                  title="Release the chain from this mode shape, at rest"
                  onClick={() => onStart(mode.index + 1)}
                >
                  ▶
                </button>
              </td>
            </tr>
          ))}
          {modes.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: 'var(--muted)', textAlign: 'center' }}>
                no free nodes — every node is driven
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="row">
        <NumberField
          label="release amplitude"
          unit="mm"
          step={0.5}
          min={0.01}
          value={amplitude * 1000}
          onChange={(value) => onAmplitude(value / 1000)}
        />
        <label className="field" style={{ flex: 'none' }}>
          <span>on release</span>
          <label className="row" style={{ gap: 5, fontSize: 11, color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={silence}
              style={{ width: 'auto' }}
              onChange={(e) => onSilence(e.target.checked)}
            />
            silence excitation
          </label>
        </label>
      </div>
      <div className="hint-text">
        Frequencies and shapes come from the symmetric problem; damping ratios come
        from the 2N state-space spectrum, so they stay exact even when the dashpots
        are not proportional to the springs.
      </div>
    </Panel>
  )
}
