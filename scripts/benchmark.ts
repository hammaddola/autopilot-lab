/**
 * Reproducible training benchmark (Phase 16). Runs the same Session code the Web Worker uses, headless.
 *
 *   npm run benchmark -- [generations=25] [preset=highway] [population=120] [seed=42] [overrides-json]
 *
 * overrides-json is a partial SimConfig merged per section, e.g. '{"genetic":{"maxGenerationSeconds":30}}'.
 *
 * Writes docs/benchmark-<preset>.json and prints a table. Then evaluates the best-ever brain against
 * unseen scenario seeds (generalisation check).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Session, type GenerationStats } from '../src/engine/session';
import { DRIVER_FILE_FORMAT, validateDriver, type DriverRecord } from '../src/storage/validation';
import {
  defaultConfig,
  networkLayers,
  presetEnv,
  sanitizeConfig,
  type EnvPreset,
} from '../src/simulation/config';

const [gens = '25', preset = 'highway', pop = '120', seed = '42', overrides = '{}'] = process.argv.slice(2);
const base = defaultConfig();
base.env = presetEnv(preset as EnvPreset, 1337);
base.genetic.populationSize = Number(pop);
base.genetic.seed = Number(seed);
const patch = JSON.parse(overrides) as Record<string, object>;
const config = sanitizeConfig(
  Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, Array.isArray(v) ? (patch[k] ?? v) : { ...v, ...patch[k] }]),
  ),
);
const tag = process.env.BENCH_TAG ?? preset;

const session = new Session({ mode: 'train', config });
const t0 = Date.now();
const rows: GenerationStats[] = [];
while (rows.length < Number(gens)) {
  const ev = session.step();
  if (ev?.type === 'generation') {
    rows.push(ev.stats);
    const s = ev.stats;
    console.log(
      `gen ${String(s.generation).padStart(3)} | best F ${s.bestFitness.toFixed(1).padStart(7)} | avg F ${s.avgFitness.toFixed(1).padStart(6)}` +
        ` | best D ${s.bestDistance.toFixed(0).padStart(6)} | avg D ${s.avgDistance.toFixed(0).padStart(5)}` +
        ` | survive ${(s.survivalRate * 100).toFixed(0).padStart(3)}% | crashes ${String(s.collisions).padStart(3)}` +
        ` | div ${s.diversity.toFixed(3)} | mut ${s.mutationRate.toFixed(3)} | ${s.wallMs} ms`,
    );
  }
}

// Generalisation: evaluate the best-ever brain on unseen seeds of the same environment.
const best = session.bestEver!;
const evalSeeds = [101, 202, 303, 404, 505];
const evaluation = evalSeeds.map((s) => {
  const cfg = { ...config, env: { ...config.env, seed: s } };
  const t = new Session({
    mode: 'test',
    config: cfg,
    drivers: [
      {
        id: 'best',
        name: 'best',
        brain: { layers: networkLayers(config), genome: best.genome },
        sensors: config.sensors,
      },
    ],
  });
  let ev = null;
  while (!ev) ev = t.step();
  const r = ev.type === 'testComplete' ? ev.results[0]! : null;
  return {
    seed: s,
    status: r?.status,
    distance: Math.round(r?.distance ?? 0),
    time: Number((r?.time ?? 0).toFixed(1)),
  };
});
console.log('\nBest-ever brain on unseen seeds:', evaluation);

const first = rows[0]!,
  last = rows[rows.length - 1]!;
const summary = {
  preset,
  overrides: patch,
  generations: rows.length,
  population: config.genetic.populationSize,
  gaSeed: config.genetic.seed,
  scenarioSeed: config.env.seed,
  wallSeconds: (Date.now() - t0) / 1000,
  first: { bestFitness: first.bestFitness, avgFitness: first.avgFitness, bestDistance: first.bestDistance },
  last: { bestFitness: last.bestFitness, avgFitness: last.avgFitness, bestDistance: last.bestDistance },
  bestEver: { fitness: best.fitness, distance: best.distance, generation: best.generation },
  evaluation,
  history: rows,
};
mkdirSync('docs/drivers', { recursive: true });
writeFileSync(`docs/benchmark-${tag}.json`, JSON.stringify(summary, null, 2));
// The best-ever brain as an importable driver file (Driver Library → Import driver).
const driver = validateDriver({
  schemaVersion: 1,
  id: `benchmark-${tag}`,
  name: `Benchmark ${tag} (gen ${best.generation})`,
  description: `Best-ever driver of the reproducible benchmark: ${preset}, scenario seed ${config.env.seed}, GA seed ${config.genetic.seed}, ${rows.length} generations.`,
  generation: best.generation,
  fitness: best.fitness,
  bestDistance: best.distance,
  brain: { layers: networkLayers(config), genome: Array.from(best.genome) },
  sensors: config.sensors,
  trainingConfig: config,
  source: 'training',
});
writeFileSync(`docs/drivers/${tag}.driver.json`, driverFileJson(driver));
console.log(`\nWrote docs/benchmark-${tag}.json in ${summary.wallSeconds.toFixed(1)} s`);

function driverFileJson(d: DriverRecord): string {
  return JSON.stringify({ format: DRIVER_FILE_FORMAT, schemaVersion: d.schemaVersion, driver: d });
}
