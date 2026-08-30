/**
 * The simulation. No UI, no rendering, no browser API -- strict SI throughout,
 * so it runs identically in a test process and in a browser frame loop.
 *
 * Time scaling and displacement exaggeration are deliberately absent. Real
 * displacements here are millimetres and real frequencies are tens of hertz;
 * making either watchable is a drawing concern, and mixing it in would mean the
 * physics changed when you moved a slider.
 */

import { Vec } from './linalg'
import {
  assembleChain,
  rebuildStiffnessInPlace,
  stiffnessScaleAt,
  type ChainMatrices,
} from './assemble'
import {
  type ChainSpec,
  assertValidChain,
  hasTimeVaryingStiffness,
  nodeAt,
  segmentCount,
} from './chain'
import { assembleForceVector, createForceScratch, type ForceScratch } from './forces'
import { Rk4Workspace, SubstepAccumulator, rk4Step, suggestTimestep } from './integrate'
import { undampedModes, type UndampedModes } from './eigen/jacobi'
import { evaluateSignal } from './signal'

export interface SimulationOptions {
  /** Fixed integration timestep, seconds. Defaults to 40 steps per fastest period. */
  readonly timestep?: number | undefined
  readonly maxStepsPerFrame?: number | undefined
}

export class Simulation {
  private spec: ChainSpec
  private matrices: ChainMatrices
  private modes: UndampedModes

  private x: Vec
  private v: Vec
  private force: Vec
  private scratch: ForceScratch
  private workspace: Rk4Workspace
  private clock: SubstepAccumulator

  /** True while any segment modulates its stiffness: modal analysis is invalid. */
  private stiffnessIsTimeVarying: boolean

  private simTime = 0
  private stepsTaken = 0
  private droppedSeconds = 0

  constructor(spec: ChainSpec, options: SimulationOptions = {}) {
    assertValidChain(spec)
    this.spec = spec
    this.matrices = assembleChain(spec)
    this.modes = undampedModes(this.matrices.Mff, this.matrices.Kff)
    this.stiffnessIsTimeVarying = hasTimeVaryingStiffness(spec)

    const dof = this.matrices.dof
    this.x = Vec.zeros(dof)
    this.v = Vec.zeros(dof)
    this.force = Vec.zeros(dof)
    this.scratch = createForceScratch(this.matrices)
    this.workspace = new Rk4Workspace(dof)
    this.clock = new SubstepAccumulator(
      options.timestep ?? suggestTimestep(this.maxOmega()),
      options.maxStepsPerFrame ?? 240,
    )
  }

  get time(): number {
    return this.simTime
  }

  get dof(): number {
    return this.matrices.dof
  }

  get timestep(): number {
    return this.clock.dt
  }

  set timestep(dt: number) {
    if (dt > 0) this.clock.dt = dt
  }

  get chain(): ChainSpec {
    return this.spec
  }

  get chainMatrices(): ChainMatrices {
    return this.matrices
  }

  /**
   * Undamped natural frequencies and mode shapes at NOMINAL stiffness.
   *
   * While `modalAnalysisIsValid` is false these are stale by construction: they
   * describe a system whose K is no longer the K being integrated. They are
   * still worth showing as a reference frame -- parametric resonance is read
   * against them -- but callers must mark them as such.
   */
  get undampedModes(): UndampedModes {
    return this.modes
  }

  /** False once any segment modulates its stiffness. */
  get modalAnalysisIsValid(): boolean {
    return !this.stiffnessIsTimeVarying
  }

  get diagnostics(): { steps: number; droppedSeconds: number } {
    return { steps: this.stepsTaken, droppedSeconds: this.droppedSeconds }
  }

  private maxOmega(): number {
    const omega = this.modes.omega
    return omega.length === 0 ? 0 : (omega[omega.length - 1] as number)
  }

  /** A timestep resolving the fastest mode, for the current chain. */
  suggestedTimestep(): number {
    return suggestTimestep(this.maxOmega())
  }

  /**
   * Swap in a new chain while running.
   *
   * Node state is carried across by node index, so toggling a node between free
   * and driven, or retuning a spring, does not jolt the chain. A node that has
   * just been freed inherits the displacement it had while driven, which is the
   * physically continuous choice. Changing the node count has no meaningful
   * correspondence, so it resets.
   */
  setChain(next: ChainSpec): void {
    assertValidChain(next)
    const sameSize = next.nodes.length === this.spec.nodes.length
    const displacement = sameSize ? this.nodeDisplacements() : undefined
    const velocity = sameSize ? this.nodeVelocities() : undefined

    this.spec = next
    this.matrices = assembleChain(next)
    this.modes = undampedModes(this.matrices.Mff, this.matrices.Kff)
    this.stiffnessIsTimeVarying = hasTimeVaryingStiffness(next)

    const dof = this.matrices.dof
    this.x = Vec.zeros(dof)
    this.v = Vec.zeros(dof)
    this.force = Vec.zeros(dof)
    this.scratch = createForceScratch(this.matrices)
    this.workspace = new Rk4Workspace(dof)

    if (displacement !== undefined && velocity !== undefined) {
      for (let a = 0; a < dof; a++) {
        const node = this.matrices.freeIndices[a] as number
        this.x.set(a, displacement[node] as number)
        this.v.set(a, velocity[node] as number)
      }
    }
  }

  /** Clears displacement, velocity and the clock, leaving the chain intact. */
  reset(): void {
    this.x.fill(0)
    this.v.fill(0)
    this.simTime = 0
    this.stepsTaken = 0
    this.droppedSeconds = 0
    this.clock.reset()
  }

  /**
   * Load mode `index` as the initial condition, scaled so its largest nodal
   * displacement equals `peakDisplacement` metres, with zero velocity.
   *
   * Zero velocity at maximum displacement is the natural standing-wave start:
   * the mode is released from rest at its extreme, so it rings at exactly its
   * own frequency and nothing else.
   */
  setStateFromMode(index: number, peakDisplacement: number): void {
    const dof = this.matrices.dof
    if (dof === 0 || index < 0 || index >= dof) return

    let peak = 0
    for (let i = 0; i < dof; i++) peak = Math.max(peak, Math.abs(this.modes.shapes.get(i, index)))
    if (peak === 0) return

    const scale = peakDisplacement / peak
    for (let i = 0; i < dof; i++) this.x.set(i, scale * this.modes.shapes.get(i, index))
    this.v.fill(0)
    this.simTime = 0
    this.clock.reset()
  }

  private acceleration = (t: number, x: Vec, v: Vec, out: Vec): void => {
    if (this.stiffnessIsTimeVarying) {
      rebuildStiffnessInPlace(this.spec, this.matrices, stiffnessScaleAt(this.spec, t))
    }
    assembleForceVector(this.spec, this.matrices, t, this.scratch, this.force)

    const { dof, Mff, Cff, Kff } = this.matrices
    for (let a = 0; a < dof; a++) {
      let sum = this.force.get(a)
      for (let b = 0; b < dof; b++) sum -= Cff.get(a, b) * v.get(b) + Kff.get(a, b) * x.get(b)
      out.set(a, sum / Mff.get(a, a))
    }
  }

  /** One fixed step. Prefer `advance`, which owns the accumulator. */
  step(h = this.clock.dt): void {
    rk4Step(this.simTime, h, this.x, this.v, this.acceleration, this.workspace)
    this.simTime += h
  }

  /**
   * Advance by `simSeconds` of SIMULATED time in whole fixed steps.
   *
   * The caller converts wall-clock time to simulated time, so the time-scale
   * control lives entirely outside the physics. A raw frame delta must never
   * reach the integrator.
   */
  advance(simSeconds: number): void {
    const result = this.clock.drain(simSeconds, () => this.step(this.clock.dt))
    this.stepsTaken = result.steps
    this.droppedSeconds = result.droppedSeconds
  }

  /** Displacement of every node, metres, indexed by node. Driven nodes read their signal. */
  nodeDisplacements(out?: Float64Array): Float64Array {
    const n = this.spec.nodes.length
    const result = out ?? new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const dofIndex = this.matrices.dofOfNode[i] as number
      result[i] =
        dofIndex >= 0
          ? this.x.get(dofIndex)
          : evaluateSignal(nodeAt(this.spec, i).motion, this.simTime).value
    }
    return result
  }

  /** Velocity of every node, m/s. Driven nodes read their analytical derivative. */
  nodeVelocities(out?: Float64Array): Float64Array {
    const n = this.spec.nodes.length
    const result = out ?? new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const dofIndex = this.matrices.dofOfNode[i] as number
      result[i] =
        dofIndex >= 0
          ? this.v.get(dofIndex)
          : evaluateSignal(nodeAt(this.spec, i).motion, this.simTime).derivative
    }
    return result
  }

  /**
   * How strongly each mode is currently excited, as the peak nodal displacement
   * that mode alone would produce, in metres.
   *
   * Modes are mass-normalised, so the modal coordinate is q_r = phi_r^T . M . x
   * and its rate is qdot_r. Reporting the envelope sqrt(q^2 + (qdot/omega)^2)
   * rather than q itself matters: q oscillates through zero every half cycle,
   * so bars driven by q would flicker at the mode frequency instead of showing
   * how much energy the mode actually holds. Converting back to peak nodal
   * displacement makes the bars comparable across modes and readable in metres.
   */
  modalAmplitudes(out?: Float64Array): Float64Array {
    const dof = this.matrices.dof
    const result = out ?? new Float64Array(dof)
    const { Mff } = this.matrices

    for (let r = 0; r < dof; r++) {
      let q = 0
      let qDot = 0
      let peakShape = 0
      for (let i = 0; i < dof; i++) {
        const phi = this.modes.shapes.get(i, r)
        const m = Mff.get(i, i)
        q += phi * m * this.x.get(i)
        qDot += phi * m * this.v.get(i)
        peakShape = Math.max(peakShape, Math.abs(phi))
      }
      const omega = this.modes.omega[r] as number
      const envelope = omega > 0 ? Math.hypot(q, qDot / omega) : Math.abs(q)
      result[r] = envelope * peakShape
    }
    return result
  }

  /** Total mechanical energy of the free degrees of freedom, joules. */
  energy(): number {
    const { dof, Mff, Kff } = this.matrices
    let kinetic = 0
    let potential = 0
    for (let a = 0; a < dof; a++) {
      kinetic += 0.5 * Mff.get(a, a) * this.v.get(a) * this.v.get(a)
      for (let b = 0; b < dof; b++) {
        potential += 0.5 * this.x.get(a) * Kff.get(a, b) * this.x.get(b)
      }
    }
    return kinetic + potential
  }

  /** Extension of each segment beyond its rest length, metres. Includes actuator stroke. */
  segmentExtensions(out?: Float64Array): Float64Array {
    const nSeg = segmentCount(this.spec)
    const result = out ?? new Float64Array(nSeg)
    const displacement = this.nodeDisplacements()
    for (let i = 0; i < nSeg; i++) {
      const actuator = evaluateSignal(this.spec.segments[i]?.actuator ?? { kind: 'off' }, this.simTime)
      result[i] =
        (displacement[i + 1] as number) - (displacement[i] as number) - actuator.value
    }
    return result
  }
}
