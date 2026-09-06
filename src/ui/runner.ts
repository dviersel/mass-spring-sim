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
import { TraceBuffer, drawTrace, type ModalSource } from './canvas/trace'
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
  /** Whole-chain history for the seismograph pens, and the multi-node traces. */
  private history: NodeTraceBuffer
  /**
   * Signed modal coordinates over time, one channel per mode.
   *
   * Kept as coordinates rather than as contributions to a particular node, so
   * changing the traced node re-reads the same history instead of discarding
   * it: the mode shape is applied at draw time.
   */
  private modalHistory: NodeTraceBuffer
  private modalScratch: Float64Array
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
    this.modalHistory = new NodeTraceBuffer(this.simulation.dof)
    this.modalScratch = new Float64Array(this.simulation.dof)
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
    // The modal history is indexed by mode, so it survives a change that leaves
    // the degree-of-freedom count alone and is discarded by one that does not.
    this.modalHistory.resize(this.simulation.dof)
    if (this.amplitudes.length !== this.simulation.dof) {
      this.amplitudes = new Float64Array(this.simulation.dof)
      this.modalScratch = new Float64Array(this.simulation.dof)
      this.overlay = null
    }
  }

  reset(): void {
    this.simulation.reset()
    this.trace.clear()
    this.history.clear()
    this.modalHistory.clear()
    this.lastTraceSample = -Infinity
  }

  /** Release the chain from a single mode. `mode` is 1-based, to match the table. */
  startFromMode(mode: number, amplitude: number): void {
    this.simulation.setStateFromMode(mode - 1, amplitude)
    this.trace.clear()
    this.history.clear()
    this.modalHistory.clear()
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
        sim.modalCoordinates(this.modalScratch)
        this.modalHistory.push(sim.time, this.modalScratch)
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
      const oldest = sim.time - this.view.traceWindow
      const modal = this.modalSource()

      // Each reading spans a different range -- a sum over eleven nodes is much
      // larger than any one of them -- so the scale follows what is actually
      // drawn rather than always following the single node.
      let peak = 0
      if (this.view.traceMode === 'all') {
        peak = this.history.peakWithin(oldest)
      } else if (this.view.traceMode === 'sum') {
        this.history.forEachSample((time, read) => {
          if (time < oldest) return
          let total = 0
          for (let node = 0; node < this.history.nodes; node++) total += read(node)
          peak = Math.max(peak, Math.abs(total))
        })
      } else if (this.view.traceMode === 'modal' && modal !== null && modal.unavailable === null) {
        // A single harmonic can overshoot the sum it belongs to, so both matter.
        this.modalHistory.forEachSample((time, read) => {
          if (time < oldest) return
          let total = 0
          for (let mode = 0; mode < this.modalHistory.nodes; mode++) {
            const contribution = (modal.shape[mode] ?? 0) * read(mode)
            total += contribution
            peak = Math.max(peak, Math.abs(contribution))
          }
          peak = Math.max(peak, Math.abs(total))
        })
      } else {
        this.trace.forEach((time, value) => {
          if (time >= oldest) peak = Math.max(peak, Math.abs(value))
        })
      }

      this.traceScale = autoRange(this.traceScale, peak)
      drawTrace(this.canvases.trace, {
        mode: this.view.traceMode,
        buffer: this.trace,
        history: this.history,
        modal,
        now: sim.time,
        window: this.view.traceWindow,
        nodeIndex: this.view.tracedNode,
        scale: this.traceScale,
      })
    }
  }

  /**
   * The traced node's share of each mode shape, or why there is not one.
   *
   * A driven node has no modal coordinates at all: its motion is imposed rather
   * than solved for, so there is nothing to decompose. And while stiffness is
   * modulating, the shapes describe a spring the chain no longer has.
   */
  private modalSource(): ModalSource | null {
    const sim = this.simulation
    const dof = sim.dof
    if (dof === 0) {
      return { coordinates: this.modalHistory, shape: new Float64Array(0), unavailable: 'no free nodes to decompose' }
    }
    if (!sim.modalAnalysisIsValid) {
      return {
        coordinates: this.modalHistory,
        shape: new Float64Array(dof),
        unavailable: 'modes are stale while stiffness varies',
      }
    }
    const dofIndex = sim.chainMatrices.dofOfNode[this.view.tracedNode] ?? -1
    if (dofIndex < 0) {
      return {
        coordinates: this.modalHistory,
        shape: new Float64Array(dof),
        unavailable: `node ${this.view.tracedNode} is driven — imposed, not composed`,
      }
    }
    const shape = new Float64Array(dof)
    for (let r = 0; r < dof; r++) shape[r] = sim.modeShapes.get(dofIndex, r)
    return { coordinates: this.modalHistory, shape, unavailable: null }
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
