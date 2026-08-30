# mass-spring-sim

An interactive simulation of a damped mass–spring chain: N masses on one
continuous spring, every node either free or driven, four independent excitation
mechanisms, and live modal analysis alongside the animation.

Built to make the behaviour legible — standing waves, resonance building and
decaying, and which excitation mechanisms couple into which modes and which ones
structurally cannot.

## Running

```sh
bun install
bun run dev       # the simulation
bun run test      # 96 headless core tests
bun run build     # typecheck + static bundle
```

No backend. The build is static.

## What to try

Each scenario in the sidebar shows one thing:

| Scenario | What to watch |
|---|---|
| **Simplest case** | Three nodes, one unknown. The whole system in miniature. |
| **Transverse** | The other regime — motion *across* the spring, restored by tension rather than stiffness. Same spectrum, different mechanism. |
| **Mode 3, released** | A pure standing wave ringing down. One bar lit, the rest at zero. |
| **Chirp sweep** | Every resonance lighting up in turn. An end shaker has no blind spot. |
| **Centre force** | Modes 2, 4, 6 and 8 never respond — the centre is a stationary point of all of them. |
| **Actuator in segment 2** | Modes 2 and 6 never respond — they have no stretch across that segment. |
| **Node 5 driven** | The chain splits into two sub-chains that cannot feel each other. Every frequency appears twice. |
| **Parametric pump** | Energy pouring in with no force and no imposed motion. Modal analysis greys out, because it no longer applies. |

The two "stay dark" scenarios are the point of the whole tool: same chain, same
sweep, different blind spots depending on *how* you push.

## Design

Notes on the physics, the numerics and the choices behind them are in
[`docs/superpowers/specs/2026-08-30-mass-spring-chain-design.md`](docs/superpowers/specs/2026-08-30-mass-spring-chain-design.md).

The short version:

- Free versus driven is a property of a **node**, not of the boundary. One code
  path assembles over every node and then partitions; the degree-of-freedom
  count is derived, never assumed.
- `M`, `C` and `K` never depend on excitation. Prescribed motion, forces and
  actuators all arrive through the force vector. Time-varying stiffness is the
  one exception and gets its own explicit regime with a visible warning.
- Every driving signal carries its exact analytical derivative — structurally,
  since the evaluator can only return both together. The dashpots need the
  velocity of an imposed motion, and RK4 asks for it at intermediate times.
- Segments are pieces of **one** spring: `k = k_total·L_total/L`, and damping
  follows the same law.
- Two motion regimes, switchable and never combined. **Longitudinal** (the
  default) is in line with the spring, restored by its own stiffness.
  **Transverse** is perpendicular to it, restored by tension (`k = T/L`) — so a
  slack string has no transverse modes, and the rest-length actuator has no
  transverse meaning and is withdrawn there. Switching regimes carries the
  spectrum across rather than jumping the pitch.
- The default drawing is the honest one: masses sliding **along** the axis with
  the coils bunching and stretching. The perpendicular plot is one toggle away
  when you want to read a mode shape off the screen.
- **Seismograph pens**: one per mass, time running up the pane, each deflecting
  exactly as its node does. A disturbance entering one end sweeps across them as
  a diagonal — a travelling wave seen directly — while a standing wave puts every
  pen in step and leaves the mode's own nodes flat.
- Computed natural frequencies match the analytical dispersion relation to
  **2.9 × machine epsilon**.

## Layout

```
src/core/   the simulation — no UI, no rendering, no browser API, no dependencies
src/ui/     React controls, Canvas rendering, the frame loop, unit exaggeration
test/       headless tests, including both analytical validations
```
