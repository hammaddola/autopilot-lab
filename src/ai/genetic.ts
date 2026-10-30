import type { Rng } from '../core/rng';
import type { GeneticConfig } from '../simulation/config';
import { GENE_LIMIT } from './network';

/** Tournament selection: sample `k` individuals uniformly and return the fittest. */
export function tournamentSelect(fitness: ArrayLike<number>, k: number, rng: Rng): number {
  let best = Math.floor(rng.next() * fitness.length);
  for (let i = 1; i < k; i++) {
    const c = Math.floor(rng.next() * fitness.length);
    if (fitness[c]! > fitness[best]!) best = c;
  }
  return best;
}

/** Uniform crossover: each gene comes from either parent with equal probability. */
export function crossover(a: Float64Array, b: Float64Array, rng: Rng): Float64Array {
  const child = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) child[i] = rng.next() < 0.5 ? a[i]! : b[i]!;
  return child;
}

/**
 * Gaussian mutation in place: each gene mutates with probability `rate` by N(0, strength²).
 * Returns the number of mutated genes.
 */
export function mutate(genome: Float64Array, rate: number, strength: number, rng: Rng): number {
  let n = 0;
  for (let i = 0; i < genome.length; i++) {
    if (rng.next() < rate) {
      const v = genome[i]! + rng.gaussian() * strength;
      genome[i] = v > GENE_LIMIT ? GENE_LIMIT : v < -GENE_LIMIT ? -GENE_LIMIT : v;
      n++;
    }
  }
  return n;
}

/** Population diversity = mean over genes of the per-gene standard deviation. */
export function diversity(genomes: readonly Float64Array[]): number {
  const n = genomes.length;
  if (n < 2) return 0;
  const len = genomes[0]!.length;
  let total = 0;
  for (let g = 0; g < len; g++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += genomes[i]![g]!;
    mean /= n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = genomes[i]![g]! - mean;
      v += d * d;
    }
    total += Math.sqrt(v / n);
  }
  return total / len;
}

/** Diversity below which adaptive mutation starts boosting the rate (uniform[-1,1] init ≈ 0.58). */
export const TARGET_DIVERSITY = 0.25;

/**
 * Adaptive mutation: scale the base rate up when the population has collapsed (low diversity) or has
 * not improved for a while, and down when diversity is high. Capped to the configured maximum of 0.5.
 */
export function adaptiveRate(base: number, div: number, stagnantGenerations: number): number {
  if (base === 0) return 0;
  let r = base * Math.max(0.5, Math.min(2.5, TARGET_DIVERSITY / Math.max(div, 1e-6)));
  if (stagnantGenerations >= 5) r *= 1.5;
  return Math.min(0.5, r);
}

export interface EvolveInput {
  genomes: readonly Float64Array[];
  fitness: readonly number[];
  bestEver: Float64Array;
  /** True when the best-ever genome belongs to the population being evolved. */
  bestEverInPopulation: boolean;
  config: GeneticConfig;
  rate: number;
  rng: Rng;
}

/**
 * Produces the next generation:
 *  0. best-ever genome copied unchanged (never lost),
 *  1. elites (top fraction of this generation) copied unchanged,
 *  2. the rest: tournament-selected parents → crossover (with probability) → mutation.
 */
export function evolve({
  genomes,
  fitness,
  bestEver,
  bestEverInPopulation,
  config,
  rate,
  rng,
}: EvolveInput): Float64Array[] {
  const n = config.populationSize;
  const order = genomes.map((_, i) => i).sort((a, b) => fitness[b]! - fitness[a]!);
  const next: Float64Array[] = [bestEver.slice()];
  const eliteCount = Math.max(1, Math.round(config.eliteFraction * n));
  for (let e = bestEverInPopulation ? 1 : 0; next.length < eliteCount && e < order.length; e++) {
    next.push(genomes[order[e]!]!.slice());
  }
  while (next.length < n) {
    const a = genomes[tournamentSelect(fitness, config.tournamentSize, rng)]!;
    let child: Float64Array;
    if (rng.next() < config.crossoverRate) {
      const b = genomes[tournamentSelect(fitness, config.tournamentSize, rng)]!;
      child = crossover(a, b, rng);
    } else child = a.slice();
    mutate(child, rate, config.mutationStrength, rng);
    next.push(child);
  }
  return next;
}
