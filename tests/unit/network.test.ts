import { describe, expect, it } from 'vitest';
import {
  NetworkRunner,
  deserializeBrain,
  genomeLength,
  randomBrain,
  serializeBrain,
  sigmoid,
  weightIndex,
  biasIndex,
} from '../../src/ai/network';
import { Rng } from '../../src/core/rng';

describe('neural network', () => {
  it('computes genome length from layers', () => {
    expect(genomeLength([8, 8, 4])).toBe(8 * 9 + 4 * 9);
    expect(genomeLength([2, 1])).toBe(3);
  });

  it('forward-propagates with tanh hidden and sigmoid output', () => {
    // 2 inputs → 1 hidden → 1 output
    const layers = [2, 1, 1];
    const genome = new Float64Array(genomeLength(layers));
    genome[weightIndex(layers, 0, 0, 0)] = 0.5;
    genome[weightIndex(layers, 0, 1, 0)] = -1;
    genome[biasIndex(layers, 0, 0)] = 0.1;
    genome[weightIndex(layers, 1, 0, 0)] = 2;
    genome[biasIndex(layers, 1, 0)] = -0.3;
    const out = new NetworkRunner(layers).forward(genome, [1, 0.25]);
    const h = Math.tanh(0.5 * 1 - 1 * 0.25 + 0.1);
    expect(out[0]).toBeCloseTo(sigmoid(2 * h - 0.3), 12);
  });

  it('treats non-finite inputs as zero', () => {
    const rng = new Rng(1);
    const b = randomBrain([3, 4, 4], rng);
    const r = new NetworkRunner(b.layers);
    const a = Array.from(r.forward(b.genome, [NaN, Infinity, 0]));
    const z = Array.from(r.forward(b.genome, [0, 0, 0]));
    expect(a).toEqual(z);
    expect(a.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('initialises reproducibly from a seed', () => {
    const a = randomBrain([8, 8, 4], new Rng(7));
    const b = randomBrain([8, 8, 4], new Rng(7));
    const c = randomBrain([8, 8, 4], new Rng(8));
    expect(Array.from(a.genome)).toEqual(Array.from(b.genome));
    expect(Array.from(a.genome)).not.toEqual(Array.from(c.genome));
  });

  it('round-trips through JSON serialization', () => {
    const b = randomBrain([8, 8, 4], new Rng(3));
    const back = deserializeBrain(JSON.parse(JSON.stringify(serializeBrain(b))));
    expect(back.layers).toEqual(b.layers);
    expect(Array.from(back.genome)).toEqual(Array.from(b.genome));
  });

  it('rejects malformed brains', () => {
    expect(() => deserializeBrain(null)).toThrow();
    expect(() => deserializeBrain({ layers: [8, 8, 4], genome: [1, 2] })).toThrow(/need/);
    expect(() => deserializeBrain({ layers: [8, 0, 4], genome: [] })).toThrow(/layers/);
    expect(() => deserializeBrain({ layers: [1, 1], genome: [1, 'x'] })).toThrow(/finite/);
    expect(() => deserializeBrain({ layers: [1, 1], genome: [1, null] })).toThrow(/finite/);
    expect(() => deserializeBrain({ layers: [1, 1000], genome: [] })).toThrow(/layers/);
  });
});
