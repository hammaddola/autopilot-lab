import { describe, expect, it } from 'vitest';
import { computeFitness } from '../../src/ai/fitness';
import { adaptiveRate, crossover, diversity, evolve, mutate, tournamentSelect } from '../../src/ai/genetic';
import { Rng } from '../../src/core/rng';
import { defaultConfig } from '../../src/simulation/config';

describe('genetic algorithm', () => {
  it('tournament selection favours fitter individuals', () => {
    const rng = new Rng(1);
    const fitness = [1, 2, 3, 4, 100];
    const counts = new Array(5).fill(0);
    for (let i = 0; i < 2000; i++) counts[tournamentSelect(fitness, 3, rng)]++;
    expect(counts[4]).toBeGreaterThan(counts[0] * 5);
    expect(counts[4] / 2000).toBeGreaterThan(0.4); // P(best in 3 draws of 5) ≈ 0.49
  });

  it('crossover takes every gene from one of the parents', () => {
    const a = new Float64Array(100).fill(1);
    const b = new Float64Array(100).fill(2);
    const c = crossover(a, b, new Rng(2));
    expect(c.every((v) => v === 1 || v === 2)).toBe(true);
    expect(c.some((v) => v === 1) && c.some((v) => v === 2)).toBe(true);
  });

  it('mutation respects the rate', () => {
    const g = new Float64Array(10000);
    expect(mutate(g.slice(), 0, 0.5, new Rng(3))).toBe(0);
    expect(mutate(g.slice(), 1, 0.5, new Rng(3))).toBe(10000);
    const n = mutate(g, 0.1, 0.5, new Rng(3));
    expect(n).toBeGreaterThan(850);
    expect(n).toBeLessThan(1150);
  });

  it('measures diversity', () => {
    const same = [new Float64Array([1, 2]), new Float64Array([1, 2])];
    expect(diversity(same)).toBe(0);
    expect(diversity([new Float64Array([0]), new Float64Array([2])])).toBeCloseTo(1);
  });

  it('adapts mutation within bounds', () => {
    expect(adaptiveRate(0.1, 0.5, 0)).toBeCloseTo(0.05);
    expect(adaptiveRate(0.1, 0.05, 0)).toBeCloseTo(0.25);
    expect(adaptiveRate(0.4, 0.01, 10)).toBe(0.5);
    expect(adaptiveRate(0, 0.01, 10)).toBe(0);
  });

  it('evolve keeps the best-ever genome unchanged and preserves population size', () => {
    const cfg = { ...defaultConfig().genetic, populationSize: 20 };
    const rng = new Rng(4);
    const genomes = Array.from({ length: 20 }, (_, i) => new Float64Array(10).fill(i));
    const fitness = genomes.map((_, i) => i);
    const bestEver = new Float64Array(10).fill(42);
    const next = evolve({
      genomes,
      fitness,
      bestEver,
      bestEverInPopulation: false,
      config: cfg,
      rate: 0.5,
      rng,
    });
    expect(next).toHaveLength(20);
    expect(Array.from(next[0]!)).toEqual(Array.from(bestEver));
    expect(next[0]).not.toBe(bestEver); // a copy
    expect(Array.from(next[0]!).every((v) => v === 42)).toBe(true);
  });
});

describe('fitness', () => {
  const w = defaultConfig().fitness;
  const ctx = { maxSpeed: 300, episodeSeconds: 60 };
  const base = {
    distance: 1000,
    checkpoints: 2,
    avgSpeed: 150,
    time: 60,
    crashed: false,
    laneDeviation: 0.2,
  };

  it('implements the documented weighted formula', () => {
    const expected = w.distance * 10 + w.checkpoints * 2 + w.speed * 0.5 + w.time * 1 - w.lane * 0.2;
    expect(computeFitness(base, w, ctx)).toBeCloseTo(expected);
  });

  it('never rewards speed for crashed drivers and penalises collisions', () => {
    const safe = computeFitness(base, w, ctx);
    const crashedFast = computeFitness({ ...base, avgSpeed: 300, crashed: true }, w, ctx);
    expect(crashedFast).toBeLessThan(safe - w.collision);
  });

  it('returns 0 for non-finite results', () => {
    expect(computeFitness({ ...base, distance: NaN }, w, ctx)).toBe(0);
  });
});
