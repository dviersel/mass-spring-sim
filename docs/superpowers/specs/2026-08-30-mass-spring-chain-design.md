# Damped mass–spring chain — design

An interactive simulation of N masses on one continuous spring, built to make
the behaviour legible: standing waves, resonance building and decaying, and
which excitation mechanisms couple into which modes.

## The system

A chain is a list of **nodes** at arc-length positions along one spring, and the
**segments** between consecutive nodes. Every node is either

- **free** — its displacement is an unknown of the system, or
- **driven** — its displacement follows a prescribed function of time.

Free versus driven is a property of a node, not of the boundary. Nodes 0 and N
are not special; they are simply nodes that usually happen to be driven. A
shaker on an interior mass is the same mechanism at a different index, and
driving an interior node splits the chain into two sub-chains that cannot feel
each other. The degree-of-freedom count follows from the spec and is never
assumed.

### Two motion regimes

A chain moves in one of two regimes. These are different physics, not two
drawings of the same thing, and they are not combined — a node carries one
degree of freedom, in whichever direction the regime names.

| | Longitudinal | Transverse |
|---|---|---|
| Direction | In line with the spring | Perpendicular to it |
| Restoring force | The spring's own stiffness resisting a change of **length** | **Tension** resisting a change of angle |
| Segment stiffness | `k = k_total·L_total/L` | `k = T/L` |
| Dispersion | `ω_n = 2√(k/m)·sin(nπ/2(N+1))` | `ω_n = 2√(T/mL)·sin(nπ/2(N+1))` |
| Slack spring | Still has modes | Has **no** modes — `T = 0` is rejected |
| Rest-length actuator | Applies | Does not (see below) |

The app opens longitudinal, drawn inline — the honest picture. Because each
regime is restored by a
quantity the other never uses, switching seeds whichever is missing with the
value that preserves the spectrum — `T = k_total·L_total` makes `T/L` equal
`k_total·L_total/L` segment for segment — so a switch changes the mechanism and
not the pitch. Without that, a longitudinal chain switched to transverse carried
zero tension into a regime that rejects it, and the resulting throw unmounted
the whole interface.

Both land on the same inverse-length law, so one assembly path serves both and
only the numerator differs. Everything else — partitioning, damping, forces,
prescribed motion, integration, modal analysis — is untouched by the regime.

**The rest-length actuator is longitudinal-only.** Winding a turnbuckle shortens
a segment along its own axis. Longitudinally that is a displacement and belongs
in the force vector. Transversely it is not: shortening a segment does not push
its ends sideways, it raises the tension — which is a stiffness change, and is
what the tension-modulation control already does. The control is therefore
withdrawn in the transverse regime with an explanation, rather than left armed
and silently inert.

**Drawing is kept distinct from motion.** The view's orientation is named
`perpendicular` / `inline` so it cannot be confused with the regime. In the
transverse regime only the perpendicular drawing is truthful and the renderer
enforces it; in the longitudinal regime the perpendicular drawing is a *plot*,
chosen by default because standing waves are almost unreadable inline, and the
caption says which it is.

## Equations

Segment `i` joins nodes `i` and `i+1`. Its extension beyond rest is
`(x_{i+1} − x_i − δ_i(t))`, where `δ_i` is an actuator's commanded change to
that segment's own rest length. A dashpot sits in parallel with each segment
spring, so it stamps into `C` with the identical connectivity pattern that the
spring stamps into `K` — this is not Rayleigh damping, and `C` is never formed
as a blend of `M` and `K`.

Assemble globally over **every** node, then partition. `M` is diagonal (lumped
masses), so `M_fd = 0` and the free rows reduce to

```
M_ff ẍ_f + C_ff ẋ_f + K_ff x_f = F_f + F_act,f − K_fd·u(t) − C_fd·u̇(t)
```

That last pair of terms is the whole design in one line:

- `M_ff`, `C_ff`, `K_ff` depend only on geometry, masses, stiffness, damping and
  which nodes are free. **They never depend on excitation.**
- Prescribed motion, external forces and actuators reach the system exclusively
  through the force vector.
- `C_fd·u̇` is why every driving signal must supply its **analytical** derivative.
  A finite difference would be both unavailable and wrong at the intermediate
  times the integrator asks about.

### Segment properties

Segments are pieces of one spring, not independent springs:

```
k_i = k_total · L_total / L_i        c_i = c_total · L_total / L_i
```

Damping follows the same inverse-length law, treating the dashpot as distributed
viscoelasticity in that same continuous spring. This reproduces
`Σ 1/k_i = 1/k_total` exactly for any spacing, equal or not. A side effect worth
knowing: with both laws in force, uneven spacing alone keeps `C ∝ K`, so the
system stays classically damped. Only an explicit per-segment override breaks
proportionality.

### Time-varying stiffness is a separate regime

Modulating a segment's stiffness changes `K` itself, which invalidates modal
analysis. It is therefore not another entry in the force vector. It is passed to
assembly as an explicit argument, so entering that regime is a visible act at
the call site; the UI raises a warning banner and greys the frequency table,
which is frozen at nominal stiffness and marked stale rather than silently
recomputed against a `K` that no longer holds.

## Numerics

**Two eigensolvers**, because they answer different questions.

- *Symmetric generalised* (`K φ = ω² M φ`, cyclic Jacobi). Gives undamped
  frequencies and **real** mode shapes — what mode initialisation, the
  participation bars and the analytical test all need. Jacobi is chosen for
  accuracy over speed: these matrices are tiny and the acceptance criterion is
  precision.
- *State-space* (`2N` complex spectrum via balance → Hessenberg → Francis QR).
  Gives **exact** damping ratios: `ω_n = |λ|`, `ζ = −Re(λ)/|λ|`. Parallel
  dashpots are classically damped only when `c/k` is uniform, so projecting `C`
  onto the undamped shapes is exact in that case and quietly approximate
  otherwise. Non-proportionality is measured, not assumed, and surfaced.

**Integration** is fixed-step RK4 behind a substep accumulator. A frame delta is
drained in whole steps with the remainder carried; the substep cap makes a slow
frame fall behind real time rather than request ever more work. The timestep
defaults to forty steps per period of the fastest mode.

**Units.** The core is strict SI and contains no notion of pixels or wall-clock
time. Real displacements here are millimetres and real frequencies are tens of
hertz, so both need independent exaggeration to be watchable — but both live
entirely in the view layer. `advance()` takes already-scaled simulated seconds.

## Definition of done

A uniform chain with both ends held has
`ω_n = 2√(k/m)·sin(nπ / 2(N+1))`. Computed frequencies match to a worst relative
error of **6.4 × 10⁻¹⁶**, about 2.9 × machine epsilon.

The transverse regime has the same treatment: `ω_n = 2√(T/mL)·sin(nπ/2(N+1))`
matches to better than 10⁻¹⁴, at every chain size, and a test pins that changing
the spring stiffness moves a transverse frequency by exactly nothing.

Driving node 5 decouples the chain into two four-mass sub-chains. The same
formula with N = 4 holds, every frequency appearing exactly twice, and the
cross-block terms of `K_ff` are exactly zero while `K_fd` retains the node-5
column — the term that would break if assembly were wrong.

Both were passing before any visual work began.

## Structure

```
src/core/     zero UI and zero rendering dependencies; strict SI
  chain.ts        nodes, segments, the scaling laws
  assemble.ts     global assembly, partitioning, in-place stiffness restamp
  forces.ts       the force vector, and only the force vector
  signal.ts       signals; value and analytical derivative, inseparably
  integrate.ts    RK4 and the substep accumulator
  simulation.ts   state, live chain swaps, modal initialisation, participation
  eigen/          Jacobi, Hessenberg-QR, combined modal analysis
  edit.ts         immutable spec edits
src/ui/       React controls, Canvas rendering, the frame loop
```

The core has no runtime dependencies at all. The eigensolvers are written
directly rather than pulled in, because they are the correctness-critical part
and their numerics need to be inspectable.

## Decisions taken during design

| Question | Choice |
|---|---|
| Damping scaling | Same inverse-length law as stiffness |
| Modal analysis | Both solvers: real shapes *and* exact ζ |
| Orientation | Transverse plot by default, honest longitudinal view on a toggle |
| Readouts | Modal participation bars plus a scrolling time trace |
| Varying-K display | Freeze at nominal and mark stale, with a warning |
| Signal library | Sine, chirp, step — all analytically differentiable; no noise |
| Multiplicity | Any number of driven nodes, forces, actuators, modulators |
| Presets | A curated set, each demonstrating one phenomenon |
| Motion regimes | Longitudinal and transverse, switchable, never combined; longitudinal is the default |
| Default drawing | Inline, the true picture; the perpendicular plot is a toggle |
| Seismograph pens | One per node in the main pane, time up, inline drawing only |

## Testing

96 tests, all headless. Beyond the two definition-of-done tests, the ones that
earn their keep are those covering what is easy to get subtly wrong:

- rigid translation under a moving boundary, which fails on any sign or
  magnitude error in the `K_fd` coupling
- a driven interior node leaving the far sub-chain at *exactly* zero
- actuators pushing their end nodes apart rather than together
- forces on driven nodes being absorbed rather than applied
- signal continuity tested by whether the jump shrinks with the sampling
  interval, plus a deliberately discontinuous case proving that test can fail
- frame-rate independence across one, sixty and jittery chunkings, plus the
  substep cap engaging rather than spiralling
- damping ratios against the closed form `ζ_r = α ω_r / 2`, including a chain
  whose upper modes are overdamped while its lower modes still ring
- every preset's on-screen claim, run and verified, so a hint cannot quietly
  become false
