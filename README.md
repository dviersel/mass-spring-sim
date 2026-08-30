# mass-spring-sim

Interactive simulation of a damped mass-spring chain: N nodes on one continuous
spring, each node either free (an unknown) or driven (prescribed motion), with
four independent excitation mechanisms and live modal analysis.

## Running

```sh
bun install
bun run dev     # interactive simulation
bun run test    # headless core tests
```

## Layout

- `src/core/` — the simulation. Zero UI and zero rendering dependencies, so it
  is testable headlessly. Strict SI units throughout.
- `src/ui/` — React controls and Canvas rendering. Owns the time-scale and
  displacement-exaggeration factors; the core never sees a pixel.
