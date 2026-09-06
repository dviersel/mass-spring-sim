/**
 * Curated scenarios.
 *
 * Each one sets up a single phenomenon worth understanding. The two symmetry
 * presets state exact results, and both are pinned by tests in
 * test/core/coupling.test.ts rather than being claims made only on screen.
 */

import { assembleChain } from '../core/assemble'
import { segmentDamping, segmentStiffness, uniformChain, type ChainSpec } from '../core/chain'
import { analyseModes } from '../core/eigen/modal'
import {
  setNodeForce,
  setNodeGroundDamping,
  setNodeMass,
  setTotals,
  setNodeMotion,
  setSegmentActuator,
  setSegmentStiffnessModulation,
  tetherAll,
  updateSegment,
} from '../core/edit'
import { chirp, sine } from '../core/signal'
import type { ViewSettings } from './view'

export const NODE_COUNT = 11
export const CHAIN_LENGTH = 1 // m
export const TOTAL_STIFFNESS = 100 // N/m end to end
/** Puts mode 1 near 2% of critical: it rings for about a second and builds in a few. */
export const TOTAL_DAMPING = 0.09 // N.s/m end to end
export const NODE_MASS = 0.05 // kg
/**
 * Chosen so the transverse spectrum lands exactly on the longitudinal one:
 * T/L_segment equals k_total.L_total/L_segment when T = k_total.L_total. Same
 * frequencies, entirely different mechanism -- which is the point of the
 * comparison.
 */
export const TENSION = TOTAL_STIFFNESS * CHAIN_LENGTH

/** The longitudinal base chain, and the starting point for most scenarios. */
export function defaultChain(): ChainSpec {
  return uniformChain({
    nodeCount: NODE_COUNT,
    length: CHAIN_LENGTH,
    totalStiffness: TOTAL_STIFFNESS,
    totalDamping: TOTAL_DAMPING,
    mass: NODE_MASS,
    drivenNodes: [0, NODE_COUNT - 1],
  })
}

/**
 * The same chain in the transverse regime, at the tension that reproduces the
 * longitudinal spectrum exactly.
 */
export function transverseChain(): ChainSpec {
  return uniformChain({
    nodeCount: NODE_COUNT,
    length: CHAIN_LENGTH,
    totalStiffness: TOTAL_STIFFNESS,
    totalDamping: TOTAL_DAMPING,
    mass: NODE_MASS,
    drivenNodes: [0, NODE_COUNT - 1],
    motionMode: 'transverse',
    tension: TENSION,
  })
}

/**
 * What the app opens with: the longitudinal regime, motion in line with the
 * spring. The transverse regime is a scenario and a switch, not the starting
 * point.
 */
export const initialChain = defaultChain

/** Undamped natural frequencies of a spec, Hz, ascending. */
export function naturalFrequenciesHz(spec: ChainSpec): number[] {
  const m = assembleChain(spec)
  return analyseModes(m.Mff, m.Cff, m.Kff).modes.map((mode) => mode.frequencyHz)
}

export interface PresetState {
  readonly spec: ChainSpec
  readonly view?: Partial<ViewSettings>
  /** Release the chain from this mode, 1-based, at this peak displacement in metres. */
  readonly startMode?: { readonly mode: number; readonly amplitude: number }
}

export interface Preset {
  readonly id: string
  readonly name: string
  /** What to watch for. This is the whole point of the preset. */
  readonly hint: string
  readonly build: () => PresetState
}

const SWEEP_LOW = 3
const SWEEP_HIGH = 50
const SWEEP_SECONDS = 45
/**
 * Stiffness swing for the parametric preset, comfortably above the 4.zeta
 * threshold (8% for the default chain) but not so far above that the growth
 * outruns the screen in a couple of seconds.
 */
const PUMP_DEPTH = 0.12

/** Mass ratio of the diatomic chain. Three is wide enough to open a clear gap. */
const HEAVY_RATIO = 3
/** On-site spring for the tethered chain, N/m. Puts the cutoff near 32 Hz. */
export const TETHER = 2000

export const PRESETS: readonly Preset[] = [
  {
    id: 'single-mass',
    name: 'Simplest case: one free mass',
    hint: 'Three nodes, two driven, one unknown between them — the whole system in miniature. One mode, one frequency, one bar. Nothing about the code changes between this and the full chain: the degree-of-freedom count simply follows from which nodes are free.',
    build: () => ({
      spec: setNodeMotion(
        uniformChain({
          nodeCount: 3,
          length: CHAIN_LENGTH,
          totalStiffness: TOTAL_STIFFNESS,
          totalDamping: TOTAL_DAMPING,
          mass: NODE_MASS,
          drivenNodes: [0, 2],
        }),
        0,
        chirp(0.0004, SWEEP_LOW, SWEEP_HIGH, SWEEP_SECONDS, 0),
      ),
      view: { timeScale: 0.2, displacementExaggeration: 60, tracedNode: 1 },
    }),
  },
  {
    id: 'transverse',
    name: 'Transverse: a plucked string',
    hint: 'The other regime: masses moving across the spring rather than along it, restored by tension instead of stiffness. Drag the stiffness and nothing moves; drag the tension and the whole thing retunes as the square root. Tension is set so the frequencies land exactly on the longitudinal ones — same spectrum, entirely different mechanism. A slack string has no transverse modes at all.',
    build: () => ({
      spec: setNodeMotion(
        transverseChain(),
        0,
        chirp(0.00015, SWEEP_LOW, SWEEP_HIGH, SWEEP_SECONDS, 0),
      ),
      view: { timeScale: 0.25, displacementExaggeration: 40, tracedNode: 3 },
    }),
  },
  {
    id: 'mode-3',
    name: 'Mode 3, released',
    hint: 'A pure standing wave with two interior nodes, ringing down on its own. Nothing drives it, so the participation bars show one bar decaying and the rest at zero.',
    build: () => ({
      // Damping is stiffness-proportional here, so zeta grows with frequency
      // and mode 3 rings down roughly three times faster than the fundamental.
      // At the default damping it is over almost before you see it, so this
      // scenario lightens the spring and slows the clock -- the point is to
      // watch a shape decay, not to prove that it does.
      spec: setTotals(defaultChain(), { totalDamping: 0.03 }),
      startMode: { mode: 3, amplitude: 0.003 },
      view: { timeScale: 0.06, overlayMode: 3, tracedNode: 3 },
    }),
  },
  {
    id: 'sweep',
    name: 'Chirp sweep, 3 to 50 Hz',
    hint: 'The end shaker sweeps upward through every resonance in turn. Each mode swells as the sweep passes its frequency and decays behind it. An end shaker has no blind spot: all nine light up.',
    build: () => ({
      spec: setNodeMotion(defaultChain(), 0, chirp(0.0006, SWEEP_LOW, SWEEP_HIGH, SWEEP_SECONDS, 0)),
      view: { timeScale: 0.25, displacementExaggeration: 40 },
    }),
  },
  {
    id: 'centre-force',
    name: 'Centre force: even modes stay dark',
    hint: 'A force on the middle mass, swept through the whole band. Every even mode has a stationary point exactly there, so pushing at that spot does no work on them -- modes 2, 4, 6 and 8 never respond, however hard you drive.',
    build: () => ({
      spec: setNodeForce(defaultChain(), 5, chirp(0.35, SWEEP_LOW, SWEEP_HIGH, SWEEP_SECONDS, 0)),
      view: { timeScale: 0.25, displacementExaggeration: 40, tracedNode: 5 },
    }),
  },
  {
    id: 'actuator-blind-spot',
    name: 'Actuator in segment 2: modes 2 and 6 stay dark',
    hint: 'A turnbuckle winding in and out inside one segment. A mode feels it only through its own stretch across that segment, and modes 2 and 6 happen to have none there -- so this actuator cannot touch them, while an identical one elsewhere would.',
    build: () => ({
      spec: setSegmentActuator(
        defaultChain(),
        2,
        chirp(0.0004, SWEEP_LOW, SWEEP_HIGH, SWEEP_SECONDS, 0),
      ),
      view: { timeScale: 0.25, displacementExaggeration: 40, tracedNode: 3 },
    }),
  },
  {
    id: 'split-chain',
    name: 'Node 5 driven: the chain splits',
    hint: 'Holding one interior mass still turns it into a wall. The chain becomes two independent four-mass sub-chains that cannot feel each other: shake the left end and the right half stays at exactly zero. Every frequency now appears twice, once per half.',
    build: () => {
      const spec = uniformChain({
        nodeCount: NODE_COUNT,
        length: CHAIN_LENGTH,
        totalStiffness: TOTAL_STIFFNESS,
        totalDamping: TOTAL_DAMPING,
        mass: NODE_MASS,
        drivenNodes: [0, 5, NODE_COUNT - 1],
      })
      // Park on the sub-chain's own fundamental so the left half resonates.
      const subChainFundamental = naturalFrequenciesHz(spec)[0] ?? 14
      return {
        spec: setNodeMotion(spec, 0, sine(0.0005, subChainFundamental)),
        view: { timeScale: 0.15, displacementExaggeration: 50, tracedNode: 7 },
      }
    },
  },
  {
    id: 'parametric',
    name: 'Parametric pump at twice mode 1',
    hint: 'No force and no imposed motion -- only the spring stiffening and softening, at twice the fundamental. Energy still pours in. Expect a single bar: the whole spring is modulated together, so K stays a scalar multiple of itself, the modes stay decoupled, and pumping grows the one mode it was seeded with and no other. Modulate a single segment instead and the modes couple. This is also the regime that breaks modal analysis, so the readouts grey out -- they describe a spring that is no longer there.',
    build: () => {
      const base = defaultChain()
      const fundamental = naturalFrequenciesHz(base)[0] ?? 7

      // Parametric growth needs the modulation to beat damping: the threshold
      // for the principal resonance is a modal stiffness swing of about 4.zeta,
      // which is 8% here. Modulating a single mid-span segment cannot get
      // close -- the fundamental barely stretches there, so segment 4 carries
      // only 0.5% of its modal stiffness and a 45% swing on it moves the mode
      // by 0.2%. Modulating the whole spring puts the full depth on every mode.
      let spec = base
      for (let i = 0; i < base.segments.length; i++) {
        spec = setSegmentStiffnessModulation(spec, i, sine(PUMP_DEPTH, 2 * fundamental))
      }

      return {
        spec,
        // Parametric growth amplifies what is already there; from exact rest
        // there is nothing to amplify.
        startMode: { mode: 1, amplitude: 0.0002 },
        view: { timeScale: 0.15, displacementExaggeration: 60, tracedNode: 5 },
      }
    },
  },
  {
    id: 'diatomic',
    name: 'Alternating masses: a forbidden band',
    hint: 'Every other mass is three times heavier, and nothing else changes. The spectrum tears in two: ten modes from 3 to 27 Hz, ten more from 46 to 53, and nothing whatsoever between them. The sweep makes the hole audible in time -- it lights the lower branch, goes completely quiet through the gap, then lights the upper one. A wave in that band has no mode to travel in, so it cannot propagate at all. The mass pattern alone did this.',
    build: () => {
      const base = uniformChain({
        nodeCount: 22,
        length: CHAIN_LENGTH,
        totalStiffness: TOTAL_STIFFNESS,
        totalDamping: TOTAL_DAMPING,
        mass: NODE_MASS,
        drivenNodes: [0, 21],
      })
      let spec = base
      // Alternate along the interior. Both ends stay driven, so the pattern is
      // the only thing distinguishing this from the plain chain.
      for (let i = 2; i < 21; i += 2) spec = setNodeMass(spec, i, NODE_MASS * HEAVY_RATIO)

      return {
        spec: setNodeMotion(spec, 0, chirp(2e-4, 3, 55, 60)),
        view: { timeScale: 0.15, displacementExaggeration: 400, tracedNode: 11 },
      }
    },
  },
  {
    id: 'light-defect',
    name: 'A light mass traps a mode',
    hint: 'One interior mass at a quarter of the others. A single mode splits off above the band -- 96 Hz, where the perfect chain stops at 64 -- and it is localised: the defect swings hard while its neighbours barely move, the amplitude dying away in both directions. Released into it, the chain rings in one small region and the rest stays nearly still. A HEAVY defect will not do this: the acoustic band already reaches down to zero, so there is no room below it to push a mode into, and only a light defect can push one out of the top.',
    build: () => {
      const base = uniformChain({
        nodeCount: 21,
        length: CHAIN_LENGTH,
        totalStiffness: TOTAL_STIFFNESS,
        totalDamping: TOTAL_DAMPING,
        mass: NODE_MASS,
        drivenNodes: [0, 20],
      })
      return {
        spec: setNodeMass(base, 10, NODE_MASS / 4),
        // The split-off mode is the highest one, which is the whole point.
        startMode: { mode: 19, amplitude: 0.002 },
        view: { timeScale: 0.02, displacementExaggeration: 300, tracedNode: 10 },
      }
    },
  },
  {
    id: 'tethered',
    name: 'Tethered chain: a cutoff frequency',
    hint: 'Every mass is also on a spring to ground. That one on-site term lifts the entire spectrum: the slowest mode is 33 Hz where the same chain untethered starts at 7. Below the cutoff sqrt(k_g/m), about 32 Hz, no wave propagates at all -- and the shaker here runs at 20 Hz, underneath it. Watch the motion die away with distance from the driven end instead of travelling down the chain. That is an evanescent wave: not damped away, but with nowhere to go.',
    build: () => {
      const spec = tetherAll(defaultChain(), TETHER)
      return {
        spec: setNodeMotion(spec, 0, sine(6e-4, 20)),
        view: { timeScale: 0.05, displacementExaggeration: 600, tracedNode: 3 },
      }
    },
  },
  {
    id: 'matched-end',
    name: 'An end that absorbs instead of reflecting',
    hint: 'The far end carries a dashpot to ground at sqrt(k.m), the chain\'s characteristic impedance, and the near end is driven at the chain\'s own fundamental. A reflecting end would build a standing wave and ring up to a large amplitude; here the wave arrives, is absorbed, and never comes back, so the response settles to a small travelling one. Matching is exact only for long waves -- near the top of the band the lattice is dispersive and some reflection returns. This is also the one damping in the system that does not share the spring connectivity, so it makes the chain non-classically damped by construction.',
    build: () => {
      const base = uniformChain({
        nodeCount: NODE_COUNT,
        length: CHAIN_LENGTH,
        totalStiffness: TOTAL_STIFFNESS,
        totalDamping: TOTAL_DAMPING,
        mass: NODE_MASS,
        drivenNodes: [0],
      })
      const impedance = Math.sqrt(segmentStiffness(base, 0) * NODE_MASS)
      const fundamental = naturalFrequenciesHz(base)[0] ?? 3.4

      return {
        spec: setNodeMotion(
          setNodeGroundDamping(base, NODE_COUNT - 1, impedance),
          0,
          sine(4e-4, fundamental),
        ),
        view: { timeScale: 0.1, displacementExaggeration: 400, tracedNode: 5 },
      }
    },
  },
  {
    id: 'non-proportional-damping',
    name: 'Damping that breaks the mode shapes',
    hint: 'One segment given six times the damping of the rest, so c/k is no longer uniform along the spring. The chain stops being classically damped, and that is not bookkeeping: released into mode 3 alone, it does not stay there. Other bars light up as it decays, because the damping couples the modes that the springs had kept independent. With the damping spread evenly they would stay dark for as long as you watched. The readout flags the regime, and the ratios come from the exact state-space spectrum rather than from projecting C onto shapes it no longer fits.',
    build: () => {
      const base = defaultChain()
      const heavy = segmentDamping(base, 4) * 6
      return {
        spec: updateSegment(base, 4, { dampingOverride: heavy }),
        startMode: { mode: 3, amplitude: 0.003 },
        view: { timeScale: 0.05, displacementExaggeration: 120, tracedNode: 5 },
      }
    },
  },
]
