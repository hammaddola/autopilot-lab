/**
 * Evaluates exported driver files on fixed scenarios (repeatable evaluation):
 *   npx tsx scripts/evaluate.ts <preset> <seed,seed,...> <driver.json> [driver.json...]
 */
import { readFileSync } from 'node:fs';
import { deserializeBrain } from '../src/ai/network';
import { Session } from '../src/engine/session';
import { defaultConfig, presetEnv, type EnvPreset } from '../src/simulation/config';
import { parseDriverFile } from '../src/storage/validation';

const [preset = 'highway', seeds = '101,202,303,404,505', ...files] = process.argv.slice(2);
const drivers = files.map((f) => parseDriverFile(readFileSync(f, 'utf8')));
for (const seed of seeds.split(',').map(Number)) {
  const cfg = defaultConfig();
  cfg.env = presetEnv(preset as EnvPreset, seed);
  const s = new Session({
    mode: 'test',
    config: cfg,
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.name,
      brain: deserializeBrain(d.brain),
      sensors: d.sensors,
    })),
  });
  let ev = null;
  while (!ev) ev = s.step();
  if (ev.type !== 'testComplete') continue;
  for (const r of ev.results)
    console.log(
      `${preset} seed ${String(seed).padEnd(5)} ${r.driverName.padEnd(40)} ${r.status.padEnd(9)} ${String(Math.round(r.distance)).padStart(6)} u  ${r.time.toFixed(1).padStart(6)} s  avg ${(r.avgSpeed * 0.36).toFixed(0)} km/h`,
    );
}
