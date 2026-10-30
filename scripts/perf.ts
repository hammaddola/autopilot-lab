/** Measures raw simulation throughput (steps/s) for different population sizes (npx tsx scripts/perf.ts). */
import { Session } from '../src/engine/session';
import { defaultConfig, presetEnv } from '../src/simulation/config';

for (const preset of ['highway', 'challenge'] as const) {
  for (const pop of [10, 120, 400]) {
    const cfg = defaultConfig();
    cfg.env = presetEnv(preset);
    cfg.genetic.populationSize = pop;
    const s = new Session({ mode: 'train', config: cfg });
    // Warm up, then time 600 steps (10 simulated seconds at 1/60 s). Early steps have the most live cars.
    for (let i = 0; i < 60; i++) s.step();
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) s.step();
    const ms = performance.now() - t0;
    console.log(
      `${preset.padEnd(9)} pop ${String(pop).padStart(3)}: ${(600_000 / ms).toFixed(0).padStart(6)} steps/s  (${(ms / 600).toFixed(3)} ms/step, ${s.world.alive} alive at end)`,
    );
  }
}
