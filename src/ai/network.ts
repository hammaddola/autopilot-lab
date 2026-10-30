import type { Rng } from '../core/rng';

/**
 * Fully-connected feed-forward network stored as a flat genome so the genetic algorithm can treat it as
 * a plain vector. For each layer transition l (n_in → n_out) the genome holds the n_out×n_in weight
 * matrix row-major followed by n_out biases.
 *
 *   h = tanh(W·x + b)        (hidden layers)
 *   y = σ(W·h + b)            (output layer, σ = logistic sigmoid)
 */
export interface Brain {
  layers: number[];
  genome: Float64Array;
}

export const MAX_LAYER_SIZE = 32;
export const MAX_LAYERS = 6;
/** Genes are clamped to this magnitude after mutation to keep activations well-conditioned. */
export const GENE_LIMIT = 8;

export function genomeLength(layers: readonly number[]): number {
  let n = 0;
  for (let l = 0; l < layers.length - 1; l++) n += layers[l + 1]! * (layers[l]! + 1);
  return n;
}

export function validateLayers(layers: unknown): layers is number[] {
  return (
    Array.isArray(layers) &&
    layers.length >= 2 &&
    layers.length <= MAX_LAYERS &&
    layers.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_LAYER_SIZE)
  );
}

/** Reproducible initialisation: uniform in [-1, 1] from the supplied seeded RNG. */
export function randomBrain(layers: number[], rng: Rng): Brain {
  const genome = new Float64Array(genomeLength(layers));
  for (let i = 0; i < genome.length; i++) genome[i] = rng.range(-1, 1);
  return { layers: layers.slice(), genome };
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Holds per-layer activation buffers so forward passes allocate nothing. */
export class NetworkRunner {
  readonly activations: Float64Array[];

  constructor(readonly layers: readonly number[]) {
    this.activations = layers.map((n) => new Float64Array(n));
  }

  forward(genome: Float64Array, inputs: ArrayLike<number>): Float64Array {
    const acts = this.activations;
    const input = acts[0]!;
    for (let i = 0; i < input.length; i++) {
      const v = inputs[i];
      input[i] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
    let g = 0;
    const last = this.layers.length - 1;
    for (let l = 0; l < last; l++) {
      const inp = acts[l]!,
        out = acts[l + 1]!;
      const nIn = inp.length,
        nOut = out.length;
      const biasBase = g + nOut * nIn;
      for (let o = 0; o < nOut; o++) {
        let sum = genome[biasBase + o]!;
        const row = g + o * nIn;
        for (let i = 0; i < nIn; i++) sum += genome[row + i]! * inp[i]!;
        const a = l + 1 === last ? sigmoid(sum) : Math.tanh(sum);
        out[o] = Number.isFinite(a) ? a : 0;
      }
      g = biasBase + nOut;
    }
    return acts[last]!;
  }
}

/** Weight index of connection i→o between layer l and l+1 (for visualisation). */
export function weightIndex(layers: readonly number[], l: number, i: number, o: number): number {
  let g = 0;
  for (let k = 0; k < l; k++) g += layers[k + 1]! * (layers[k]! + 1);
  return g + o * layers[l]! + i;
}

export function biasIndex(layers: readonly number[], l: number, o: number): number {
  let g = 0;
  for (let k = 0; k < l; k++) g += layers[k + 1]! * (layers[k]! + 1);
  return g + layers[l + 1]! * layers[l]! + o;
}

export interface SerializedBrain {
  layers: number[];
  genome: number[];
}

export function serializeBrain(b: Brain): SerializedBrain {
  return { layers: b.layers.slice(), genome: Array.from(b.genome) };
}

/** Validates untrusted data and returns a Brain, or throws an Error with a user-readable message. */
export function deserializeBrain(data: unknown): Brain {
  if (!data || typeof data !== 'object') throw new Error('Brain must be an object.');
  const { layers, genome } = data as Record<string, unknown>;
  if (!validateLayers(layers))
    throw new Error(`Brain layers must be ${2}–${MAX_LAYERS} integers between 1 and ${MAX_LAYER_SIZE}.`);
  if (!Array.isArray(genome)) throw new Error('Brain genome must be an array of numbers.');
  const expected = genomeLength(layers);
  if (genome.length !== expected)
    throw new Error(
      `Brain genome has ${genome.length} values; layers [${layers.join(', ')}] need ${expected}.`,
    );
  const g = new Float64Array(expected);
  for (let i = 0; i < expected; i++) {
    const v = genome[i];
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new Error(`Brain genome value #${i} is not a finite number.`);
    g[i] = Math.max(-GENE_LIMIT * 4, Math.min(GENE_LIMIT * 4, v));
  }
  return { layers: layers.slice(), genome: g };
}
