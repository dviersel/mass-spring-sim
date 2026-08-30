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

Motion is longitudinal: one degree of freedom per node, along the spring axis.

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
