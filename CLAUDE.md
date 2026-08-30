# mass-spring-sim

Interactive simulation of a damped mass–spring chain: N nodes on one continuous
spring, each node free or driven, four excitation mechanisms, live modal
analysis. Browser only, no backend.

```sh
bun run dev        # interactive
bun run test       # 146 headless tests
bun run typecheck  # tsc --noEmit
bun run build      # typecheck + static bundle
```

## The rule that shapes everything

**`src/core/` has zero runtime dependencies, no UI, no rendering, no browser
API, and strict SI units.** It must stay runnable in a bare Node process. If you
reach for `window`, a colour, or a pixel inside `core/`, the design has gone
wrong — that belongs in `src/ui/`.

## Invariants — check these before changing physics

These are easy to break in ways tests elsewhere will not catch.

1. **Free vs driven is a property of a NODE, not of the boundary.** Global M, C
   and K are assembled over *every* node in one code path, then partitioned. The
   degree-of-freedom count is derived from the spec — never assume 9, or any
   number. Driving an interior node must split the chain into independent
   sub-chains.

2. **Segments are pieces of one spring.** `k = k_total·L_total/L` longitudinally,
   `k = T/L` transversely. Damping follows the same inverse-length law, which is
   what keeps `c/k` uniform and the system classically damped under uneven
   spacing.

3. **Damping is a parallel dashpot.** C stamps in with K's exact connectivity.
   Never a blend of M and K — no Rayleigh damping.

4. **M, C and K must not depend on excitation.** Prescribed motion, forces and
   actuators reach the system only through the force vector, via
   `F = F_ext + F_act − K_fd·u(t) − C_fd·u̇(t)`. Time-varying stiffness is the
   one exception, passed to assembly explicitly so the regime switch is visible
   at the call site, and it greys out the modal readouts.

5. **Every signal carries its exact analytical derivative.** `evaluateSignal`
   can only return both together, so a signal without one is not expressible.
   The dashpots need the velocity of an imposed motion and RK4 asks at
   intermediate times. Never add a waveform without a closed-form derivative
   (this is why there is no noise option).

6. **Fixed timestep behind a substep accumulator.** A raw frame delta must never
   reach the integrator. `advance()` takes already-scaled *simulated* seconds.

7. **SI stays out of the view layer and pixels stay out of the core.** Time
   scale and displacement exaggeration are drawing concerns; real displacements
   are millimetres and real frequencies tens of hertz.

## Gotchas that cost time here

- **`noUncheckedIndexedAccess` is on and applies to `Float64Array` too.** Numeric
  code uses the `Matrix` and `Vec` accessors in `core/linalg.ts` so there is not
  a single non-null assertion in `core/`. Keep it that way.

- **Compare against `sim.time`, not the duration you asked for.** A fixed
  timestep lands on a whole number of steps, so the two differ by up to half a
  step — which at these velocities dwarfs the integration error and reads as a
  physics bug. This produced a phantom "3% error" once.

- **RK4 is not symplectic.** Amplitude decays at roughly `θ⁶/72` per step with
  `θ = ω·h`. Bound the drift in tests; do not assert it away.

- **Signal continuity must be tested by whether the jump shrinks with the
  sampling interval,** not by whether it is small. Sampling either side of any
  join always shows a gap of about `2ε·f'(t)`. There is a deliberately
  discontinuous case in the suite proving that test can fail.

- **Parametric resonance has a threshold of about `4ζ`.** Modulating a single
  mid-span segment cannot reach it — segment 4 carries ~0.5% of the
  fundamental's modal stiffness, so a 45% swing moves the mode by 0.2%. The
  scenario modulates the whole spring instead.

- **Switching motion regimes must seed the other regime's restoring quantity.**
  A longitudinal chain carries no tension; carrying that zero into the
  transverse regime makes a system with no restoring force, which the validator
  rejects — and a throw from a React effect unmounts the whole interface. There
  is an error boundary now, but fix the cause, not the symptom.

- **The panes are indexed differently.** Seismograph pens are per *node*;
  participation bars are per *mode*, one per degree of freedom. They share a hue
  ramp deliberately, so both axes are named on screen. Clicking bar *n* traces
  node *n*, which crosses the two indexings on purpose: it is a shortcut to the
  node of that number, not a claim that mode *n* lives on node *n*. Do not
  "correct" it.

## Testing

`test/` is entirely headless. Two tests are the acceptance criteria and must
keep passing to ~machine precision:

- a uniform chain matching `ω_n = 2√(k/m)·sin(nπ/2(N+1))` (currently 6.4e-16
  relative, ~2.9 × machine epsilon)
- node 5 driven, giving the N=4 spectrum with every frequency exactly twice

**Every scenario's on-screen claim is tested by running it** (see
`test/core/presets.test.ts`). If you change a hint, change or add its test — a
hint must not be able to quietly become false. Writing these caught a real bug:
the parametric scenario originally did not pump at all.

## Conventions

- Comments explain *why*, especially where the physics or the numerics are
  subtle. Match the surrounding density; do not narrate obvious code.
- Prefer the honest presentation over the convenient one. Where a control cannot
  be truthful — a rest-length actuator transversely, seismograph pens with a
  perpendicular drawing — disable it and say why rather than let it silently do
  nothing.
- Verify UI changes in a browser, not only via tests. Several bugs here were
  invisible to the suite: fields collapsed to their spinner arrows, a mode
  overlay that drew in one view and not the other, unreadable text on the accent
  fill.
