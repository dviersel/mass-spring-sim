/**
 * Drives the simulation from requestAnimationFrame and paints the three views.
 *
 * Deliberately not a React component. Sixty React renders a second to move a
 * canvas would be waste; instead the frame loop draws imperatively and React
 * only re-renders when the chain, the settings, or the slow statistics change.
 *
 * This is also the one place wall-clock time exists. It converts a frame delta
 * into simulated seconds via the time scale and hands that to `advance`, which
 * drains it in fixed steps. The raw delta never reaches the integrator.
 */

import { Simulation } from '../core/simulation'
import type { ChainSpec } from '../core/chain'
import type { ModeSummary } from '../core/eigen/modal'
import { drawChain } from './canvas/chainView'
import { drawParticipation } from './canvas/participation'
import { TraceBuffer, drawTrace } from './canvas/trace'
import { NodeTraceBuffer } from './canvas/seismograph'
import type { ViewSettings } from './view'

export interface RunnerStats {
  readonly time: number
  readonly dof: number
  readonly stepsLastFrame: number
  readonly droppedSeconds: number
  readonly energy: number
  readonly timestep: number
  readonly modes: readonly ModeSummary[]
  readonly modalAnalysisIsValid: boolean
  readonly classicallyDamped: boolean
  readonly nonProportionality: number
}

export interface RunnerCanvases {
  chain: HTMLCanvasElement | null
  participation: HTMLCanvasElement | null
  trace: HTMLCanvasElement | null
}

/** Longest wall-clock delta honoured. Longer gaps mean a background tab. */
const MAX_FRAME_SECONDS = 1 / 15
/** Roughly how many trace samples fill the visible window. */
const TRACE_SAMPLES = 700
/** Time constant for the auto-ranging plot scales, in frames. */
const SCALE_SMOOTHING = 0.06

export class Runner {
  readonly simulation: Simulation
  private view: ViewSettings
  private running = true
  private frameHandle: number | null = null
  private lastTimestamp: number | null = null

  private trace = new TraceBuffer()
  /** Whole-chain history for the seismograph pens. */
  private history: NodeTraceBuffer
  private lastTraceSample = -Infinity

  private displacements: Float64Array
  private amplitudes: Float64Array
  private overlay: Float64Array | null = null

  private participationScale = 1e-3
  private traceScale = 1e-3
  private statsAccumulator = 0

  constructor(
    spec: ChainSpec,
    view: ViewSettings,
    private canvases: RunnerCanvases,
    private onStats: (stats: RunnerStats) => void,
  ) {
    this.simulation = new Simulation(spec)
    this.view = view
    this.history = new NodeTraceBuffer(spec.nodes.length)
    this.displacements = new Float64Array(spec.nodes.length)
    this.amplitudes = new Float64Array(this.simulation.dof)
  }

  start(): void {
    if (this.frameHandle !== null) return
    this.lastTimestamp = null
    this.frameHandle = requestAnimationFrame(this.frame)
  }

  stop(): void {
    if (this.frameHandle === null) return
    cancelAnimationFrame(this.frameHandle)
    this.frameHandle = null
  }

  setRunning(running: boolean): void {
    this.running = running
    // Drop the stale timestamp so resuming does not deliver the whole pause as
    // one enormous frame delta.
    this.lastTimestamp = null
  }

  get isRunning(): boolean {
    return this.running
  }

  setView(view: ViewSettings): void {
    // The single-node trace is recorded for one node at one resolution, so
    // changing either invalidates it. The seismograph history holds every node
    // and survives both.
    if (view.tracedNode !== this.view.tracedNode || view.traceWindow !== this.view.traceWindow) {
      this.trace.clear()
      this.lastTraceSample = -Infinity
    }
    this.view = view
  }

  setChain(spec: ChainSpec): void {
    this.simulation.setChain(spec)
    if (this.displacements.length !== spec.nodes.length) {
      this.displacements = new Float64Array(spec.nodes.length)
    }
    // A resize clears the pens: past samples describe a chain with a different
    // number of nodes and cannot be replotted against this one.
    this.history.resize(spec.nodes.length)
    if (this.amplitudes.length !== this.simulation.dof) {
      this.amplitudes = new Float64Array(this.simulation.dof)
      this.overlay = null
    }
  }

  reset(): void {
    this.simulation.reset()
    this.trace.clear()
    this.history.clear()
    this.lastTraceSample = -Infinity
  }

  /** Release the chain from a single mode. `mode` is 1-based, to match the table. */
  startFromMode(mode: number, amplitude: number): void {
    this.simulation.setStateFromMode(mode - 1, amplitude)
    this.trace.clear()
    this.history.clear()
    this.lastTraceSample = -Infinity
  }

  /**
   * Overlay a mode shape as a dashed reference curve. `mode` is 1-based; null
   * clears it.
   */
  setOverlayMode(mode: number | null, amplitude: number): void {
    if (mode === null) {
      this.overlay = null
      return
    }
    const index = mode - 1
    const shapes = this.simulation.modeShapes
    const matrices = this.simulation.chainMatrices
    if (index < 0 || index >= matrices.dof) {
      this.overlay = null
      return
    }
    let peak = 0
    for (let i = 0; i < matrices.dof; i++) peak = Math.max(peak, Math.abs(shapes.get(i, index)))
    if (peak === 0) {
      this.overlay = null
      return
    }
    const overlay = new Float64Array(this.simulation.chain.nodes.length)
    for (let a = 0; a < matrices.dof; a++) {
      overlay[matrices.freeIndices[a] as number] = (amplitude * shapes.get(a, index)) / peak
    }
    this.overlay = overlay
  }

  private frame = (timestamp: number): void => {
    this.frameHandle = requestAnimationFrame(this.frame)

    const previous = this.lastTimestamp
    this.lastTimestamp = timestamp
    const wallSeconds =
      previous === null ? 0 : Math.min(MAX_FRAME_SECONDS, (timestamp - previous) / 1000)

    if (this.running && wallSeconds > 0) {
      const traceInterval = this.view.traceWindow / TRACE_SAMPLES
      this.simulation.advance(wallSeconds * this.view.timeScale, (sim) => {
        if (sim.time - this.lastTraceSample < traceInterval) return
        this.lastTraceSample = sim.time
        sim.nodeDisplacements(this.displacements)
        this.trace.push(sim.time, this.displacements[this.view.tracedNode] ?? 0)
        this.history.push(sim.time, this.displacements)
      })
    }

    this.draw()

    this.statsAccumulator += wallSeconds
    if (this.statsAccumulator >= 0.12) {
      this.statsAccumulator = 0
      this.emitStats()
    }
  }

  private draw(): void {
    const sim = this.simulation
    sim.nodeDisplacements(this.displacements)

    if (this.canvases.chain !== null) {
      drawChain(this.canvases.chain, {
        spec: sim.chain,
        displacements: this.displacements,
        view: this.view,
        overlay: this.overlay,
        history: this.history,
        now: sim.time,
      })
    }

    if (this.canvases.participation !== null) {
      if (this.amplitudes.length !== sim.dof) this.amplitudes = new Float64Array(sim.dof)
      sim.modalAmplitudes(this.amplitudes)
      let peak = 0
      for (const value of this.amplitudes) peak = Math.max(peak, value)
      this.participationScale = autoRange(this.participationScale, peak)
      drawParticipation(this.canvases.participation, {
        amplitudes: this.amplitudes,
        modes: sim.modalAnalysis.modes,
        scale: this.participationScale,
        scaleMode: this.view.participationScale,
        stale: !sim.modalAnalysisIsValid,
      })
    }

    if (this.canvases.trace !== null) {
      let peak = 0
      const oldest = sim.time - this.view.traceWindow
      this.trace.forEach((time, value) => {
        if (time >= oldest) peak = Math.max(peak, Math.abs(value))
      })
      this.traceScale = autoRange(this.traceScale, peak)
      drawTrace(this.canvases.trace, {
        buffer: this.trace,
        now: sim.time,
        window: this.view.traceWindow,
        nodeIndex: this.view.tracedNode,
        scale: this.traceScale,
      })
    }
  }

  emitStats(): void {
    const sim = this.simulation
    const analysis = sim.modalAnalysis
    this.onStats({
      time: sim.time,
      dof: sim.dof,
      stepsLastFrame: sim.diagnostics.steps,
      droppedSeconds: sim.diagnostics.droppedSeconds,
      energy: sim.energy(),
      timestep: sim.timestep,
      modes: analysis.modes,
      modalAnalysisIsValid: sim.modalAnalysisIsValid,
      classicallyDamped: analysis.classicallyDamped,
      nonProportionality: analysis.nonProportionality,
    })
  }
}

/**
 * Ease a plot's range towards the current peak.
 *
 * Growing fast and shrinking slowly keeps a decaying signal visible instead of
 * having the axis chase it down and make the decay look flat.
 */
function autoRange(current: number, peak: number): number {
  const floor = 1e-7
  const target = Math.max(floor, peak * 1.15)
  const rate = target > current ? SCALE_SMOOTHING * 3 : SCALE_SMOOTHING * 0.35
  return current + (target - current) * rate
}
