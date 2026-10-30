import { describe, expect, it } from 'vitest';
import { Session, type GenerationStats } from '../../src/engine/session';
import { Rng } from '../../src/core/rng';
import { defaultConfig, presetEnv, sanitizeConfig, type EnvPreset } from '../../src/simulation/config';
import { Road } from '../../src/simulation/road';
import { Traffic } from '../../src/simulation/traffic';
import { polygonsIntersect } from '../../src/core/geometry';

function smallConfig() {
  const c = defaultConfig();
  c.genetic.populationSize = 20;
  c.genetic.maxGenerationSeconds = 10;
  return c;
}

function runGenerations(n: number): GenerationStats[] {
  const s = new Session({ mode: 'train', config: smallConfig() });
  const out: GenerationStats[] = [];
  while (out.length < n) {
    const ev = s.step();
    if (ev?.type === 'generation') out.push(ev.stats);
  }
  return out;
}

describe('seeded determinism', () => {
  it('RNG streams are reproducible', () => {
    const a = new Rng(5),
      b = new Rng(5);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('same seeds produce identical training runs', () => {
    const a = runGenerations(2).map(({ wallMs: _w, timestamp: _t, ...r }) => r);
    const b = runGenerations(2).map(({ wallMs: _w, timestamp: _t, ...r }) => r);
    expect(a).toEqual(b);
  });

  it('traffic positions are a pure function of time and never overlap within a lane', () => {
    for (const preset of ['highway', 'dense', 'obstacles', 'challenge', 'urban'] as EnvPreset[]) {
      const env = presetEnv(preset, 9);
      const road = new Road(env);
      const a = new Traffic(road, env, defaultConfig().physics);
      const b = new Traffic(road, env, defaultConfig().physics);
      a.update(0, 0, 0); // b skips straight to t=20 — results must match anyway
      const va = a.update(20, 0, 4000).map((v) => [v.x, v.y]);
      const vb = b.update(20, 0, 4000).map((v) => [v.x, v.y]);
      expect(va.sort()).toEqual(vb.sort());
      const act = a.active;
      for (let i = 0; i < act.length; i++)
        for (let j = i + 1; j < act.length; j++)
          expect(
            polygonsIntersect(act[i]!.poly, act[j]!.poly),
            `${preset}: vehicles ${i} and ${j} overlap`,
          ).toBe(false);
    }
  });

  it('never blocks every lane with obstacles in a single row', () => {
    const env = { ...presetEnv('obstacles', 3), obstacleDensity: 1 };
    const road = new Road(env);
    const t = new Traffic(road, env, defaultConfig().physics);
    t.update(0, 0, 20000);
    const rows = new Map<number, Set<number>>();
    for (const v of t.vehicles.filter((v) => v.kind === 'obstacle')) {
      const key = Math.round(v.s0);
      rows.set(key, (rows.get(key) ?? new Set()).add(v.lane));
    }
    expect(rows.size).toBeGreaterThan(5);
    for (const lanes of rows.values()) expect(lanes.size).toBeLessThan(env.laneCount);
  });
});

describe('training session', () => {
  it('preserves the best-ever driver across generations', () => {
    const stats = runGenerations(4);
    let best = -Infinity;
    for (const s of stats) {
      // The unchanged best-ever genome is re-evaluated each generation on the same scenario.
      expect(s.bestFitness).toBeGreaterThanOrEqual(best - 1e-9);
      best = Math.max(best, s.bestFitness);
    }
  });

  it('exports and restores training state exactly', () => {
    const cfg = smallConfig();
    const a = new Session({ mode: 'train', config: cfg });
    while (a.step()?.type !== 'generation');
    const restored = new Session({ mode: 'train', config: cfg, state: a.exportState() });
    let ea = null,
      eb = null;
    while (!ea) ea = a.step();
    while (!eb) eb = restored.step();
    expect(ea.type === 'generation' && eb.type === 'generation').toBe(true);
    if (ea.type === 'generation' && eb.type === 'generation')
      expect(eb.stats.bestFitness).toBe(ea.stats.bestFitness);
  });

  it('every environment preset builds and steps', () => {
    for (const p of ['highway', 'urban', 'curved', 'obstacles', 'dense', 'challenge'] as EnvPreset[]) {
      const cfg = smallConfig();
      cfg.env = presetEnv(p);
      const s = new Session({ mode: 'manual', config: cfg });
      s.manual.throttle = 1;
      for (let i = 0; i < 120; i++) s.step();
      expect(s.world.cars[0]!.loc.s).toBeGreaterThan(100);
    }
  });

  it('sanitizes out-of-range configuration', () => {
    const c = sanitizeConfig({
      genetic: { populationSize: 5000, mutationRate: 9 },
      sensors: { rayCount: NaN },
      env: { preset: 'nope' },
    });
    expect(c.genetic.populationSize).toBe(400);
    expect(c.genetic.mutationRate).toBe(0.5);
    expect(c.sensors.rayCount).toBe(7);
    expect(c.env.preset).toBe('highway');
  });
});
