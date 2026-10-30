# Architecture & design decisions

This document records the decisions behind Autopilot Lab and explains the AI system for developers who
want to extend it. The README has the overview; this is the "why".

## Layers

```
          ┌────────────────────────── main thread ───────────────────────────┐
 UI       │ ui/pages/*  ui/components/*  ui/render/{renderer,networkView}    │
          │              ▲ reads state / subscribes to events                │
 App      │ app/controller (owns worker)  app/router  app/preferences  pwa   │
          │      │ typed messages (workers/protocol.ts)       storage/db ◄───┤ IndexedDB
          └──────┼───────────────────────────────────────────────────────────┘
                 ▼
          ┌────────────────────────── Web Worker ────────────────────────────┐
 Engine   │ workers/simulation.worker → engine/session (train | test | manual)│
 AI       │ ai/network  ai/genetic  ai/fitness                               │
 Sim      │ simulation/{world, road, traffic, car, sensor, config}           │
 Core     │ core/{rng, geometry}                                             │
          └──────────────────────────────────────────────────────────────────┘
```

Dependency rule: lower layers never import higher ones. `simulation`, `ai` and `engine` contain no DOM code,
which is why the exact same code runs in the worker, in Vitest and in the Node benchmark script.

## ADR-1 Vanilla TypeScript + small component functions, no UI framework

The UI is a handful of pages with live panels updated at 4–10 Hz. A framework's diffing would add bundle
weight and indirection without solving a real problem. Components are plain functions returning elements
(`button()`, `panel()`, `slider()`, `stat()`, `lineChart()`, `viewport()`...). All text goes through
`textContent` (via the `h()` helper), so user-supplied names can never inject HTML.

## ADR-2 Everything simulated runs in one Web Worker; the main thread only renders

All three modes (train/test/manual) run in the worker, not just training. This gives one code path, keeps the
UI responsive at 400 cars × 10×, and makes manual driving behave exactly like the AI's physics.

- **Fixed timestep**: the session always advances by `FIXED_DT = 1/60 s`. The worker uses an accumulator
  scaled by the speed multiplier (1/2/5/10×) and a 14 ms per-tick budget. If the CPU cannot keep up, the
  simulation runs slower than requested (visible in the performance overlay) — it never takes bigger steps,
  so physics and results are identical at every speed.
- **Rendering is independent**: `requestAnimationFrame` draws the latest frame snapshot with a smoothed camera.
- **Efficient transfer**: vehicle poses are packed into `Float32Array`s and _transferred_ (zero-copy).
  The road is never sent: it is rebuilt on the main thread from the deterministic environment config.
  The focus car's genome is only sent when the focus car changes.
- **Validation**: `parseRequest()` validates every message arriving in the worker; configs are re-clamped with
  `sanitizeConfig()` and brains/checkpoints re-validated there too.
- **Crash handling**: `worker.onerror` marks the session as errored and offers "Resume from checkpoint".

## ADR-3 Deterministic, time-analytic traffic

Every traffic vehicle's position is `s(t) = s₀ + v·t` along its lane, and all vehicles in a lane share that
lane's speed. Consequences:

- the scene is a pure function of `(seed, t)` — identical for every car in a generation and every generation
  with the same seed, regardless of when a vehicle was materialised (tested in `session.test.ts`);
- vehicles in a lane can never overlap; lanes have slightly different speeds (left faster), so gaps open
  and close realistically;
- rows never occupy every lane, and static obstacles use lanes disjoint from moving traffic, so no
  configuration is permanently blocked.

Vehicles are generated lazily in rows ~900 units ahead of the leading agent and dropped 500 units behind
the last one, so memory and per-step cost are independent of road length.

## ADR-4 Road as a sampled centreline

The road is a centreline sampled every 20 units with a curvature profile per layout (straight, sweeping
curves, urban bends). Borders and lane centres are offsets of the centreline, and each car tracks its road
index with a local search, so: progress = arc length `s`, lane offset = `d`, and sensors/border collisions
only test the ±k segments near the car (O(1) in road length). Heading is bounded so the road never loops
back onto itself.

## ADR-5 Persistence: IndexedDB for data, LocalStorage for preferences only

Stores (`drivers`, `experiments`, `checkpoints`, `benchmarks`) in database `autopilot-lab`, version 2.

- **Migrations** fall through in `onupgradeneeded` from the user's version (v1 created three stores; v2
  added `benchmarks` and the `checkpoints.experimentId` index). Records are never rewritten by a migration.
- **Validation on read**: every record passes through its validator; corrupt ones are skipped (not deleted)
  and reported, and Settings offers a confirmed "Remove damaged records".
- **No silent overwrite**: new records use `add()` (fails on an existing id); imports re-id conflicts;
  only the single _auto_ checkpoint per experiment is replaced, in one transaction, and never a manual one.
- LocalStorage holds the theme/quality/overlay preferences and the last-used simulation config (< 1 KB).

## ADR-6 PWA with a build-generated service worker

A tiny Vite plugin writes `dist/sw.js` after each build with the full list of emitted files and a content
hash as cache version. Install precaches the shell; activate deletes old `autopilot-lab-shell-*` caches;
fetch is cache-first (`ignoreVary`, because module scripts send an `Origin` header the precache request did
not). Updates wait for the user ("Update now" → `SKIP_WAITING` → reload). IndexedDB data is never cached.

---

## The neural network

Fully-connected feed-forward network, default `[8, 8, 4]`.

**Inputs** (`n = rays + 1`):

- `xᵢ = 1 − dᵢ / R` for ray `i` if it hits something at distance `dᵢ` within range `R`, else `0`
  (so 0 = clear, → 1 = touching). Rays are spread evenly over the field of view, left to right.
- `xₙ = v / v_max` (forward speed, negative when reversing).

**Forward pass** for each layer `l`:

```
z⁽ˡ⁾ = W⁽ˡ⁾ a⁽ˡ⁻¹⁾ + b⁽ˡ⁾
a⁽ˡ⁾ = tanh(z⁽ˡ⁾)          hidden layers
y    = σ(z⁽ᴸ⁾) = 1/(1+e⁻ᶻ)  output layer
```

**Outputs → controls**: `throttle = [y₀ > ½]`, `steer = [y₂ > ½] − [y₁ > ½]`, `brake = [y₃ > ½]` (brake
reverses once stopped). Thresholding makes small weight changes produce discrete behaviour changes,
which suits mutation-based search.

**Genome layout** (`ai/network.ts`): for each layer transition `l` the `n_out × n_in` weight matrix,
row-major, followed by `n_out` biases. `weightIndex()` / `biasIndex()` locate a parameter.
Length = Σ n_out·(n_in + 1) (108 for 8-8-4).

**Robustness**: non-finite inputs become 0, non-finite activations become 0, genes are clamped to ±8 after
mutation, and imported genomes must have exactly the right length and only finite numbers.

## The genetic algorithm

Per generation (`ai/genetic.ts`, `engine/session.ts`):

1. Every individual drives the **same seeded scenario** until it crashes, stalls (no forward progress for
   `stallSeconds`), finishes, or hits the time limit.
2. Fitness (`ai/fitness.ts`):
   `F = w_d·D/100 + w_c·C + w_s·(S̄/v_max)·[no crash] + w_t·(T/T_episode) − w_col·[crash] − w_l·L`
   with distance `D`, 50 m checkpoints `C`, mean speed `S̄`, productive time `T` (stalled cars are removed so
   idling earns nothing), lane deviation `L ∈ [0,1]`. Speed is only rewarded to cars that did not crash.
3. Next population:
   - slot 0 — the **best-ever genome, unchanged** (re-evaluated every generation; it can never be lost);
   - elites — the top `eliteFraction` of this generation, unchanged;
   - the rest — two parents by **tournament selection** (size k) → **uniform crossover** with probability
     `crossoverRate` → **Gaussian mutation** (each gene with probability μ gets `+ N(0, σ²)`).
4. **Diversity** = mean over genes of the population standard deviation of that gene.
   **Adaptive mutation**: `μ' = μ · clamp(0.25 / diversity, 0.5, 2.5)`, ×1.5 after 5 generations without a
   new best, capped at 0.5.
5. Determinism: initial weights come from `Rng(geneticSeed)`, selection/mutation from a derived stream whose
   state is saved in checkpoints, so a resumed run continues exactly as if it had never stopped (tested).

## Extending the AI

- **New sensor input** (e.g. lane offset): append it in `Session.decide` and add 1 to
  `networkLayers()`; update `inputLabels()` in `ui/render/networkView.ts` for the visualisation.
- **Different activation / output mapping**: `NetworkRunner.forward` and `outputsToControls`.
- **New fitness term**: add a field to `DriveStats` + `FitnessWeights`, compute it in `Session.driveStats`,
  clamp it in `sanitizeConfig`, and add a slider in `ui/pages/training.ts`.
- **Another optimiser** (e.g. CMA-ES, NEAT): replace `evolve()`; the session only needs a new list of genomes
  per generation. Checkpoints store genomes as plain arrays, so the format stays compatible.
- **Bump `SCHEMA_VERSION`** in `storage/validation.ts` when a driver's on-disk shape changes, and teach
  `validateDriver` to upgrade older versions.
