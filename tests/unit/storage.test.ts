import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { randomBrain, serializeBrain } from '../../src/ai/network';
import { Rng } from '../../src/core/rng';
import { Session } from '../../src/engine/session';
import { defaultConfig } from '../../src/simulation/config';
import * as db from '../../src/storage/db';
import {
  DRIVER_FILE_FORMAT,
  parseDriverFile,
  validateDriver,
  validateTrainingState,
  type CheckpointRecord,
  type DriverRecord,
} from '../../src/storage/validation';

function driver(id = 'd1'): DriverRecord {
  const cfg = defaultConfig();
  return validateDriver({
    schemaVersion: 1,
    id,
    name: 'Test driver',
    brain: serializeBrain(randomBrain([8, 8, 4], new Rng(1))),
    sensors: cfg.sensors,
    trainingConfig: cfg,
    generation: 3,
    fitness: 12.5,
    bestDistance: 800,
  });
}

beforeEach(async () => {
  await db.closeDb();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(db.DB_NAME);
    r.onsuccess = r.onerror = () => resolve();
  });
});

describe('imported driver validation', () => {
  it('accepts an exported driver file', () => {
    const d = driver();
    const back = parseDriverFile(JSON.stringify({ format: DRIVER_FILE_FORMAT, driver: d }));
    expect(back.brain).toEqual(d.brain);
    expect(back.name).toBe('Test driver');
  });

  it('rejects malformed, oversized and mismatched files', () => {
    expect(() => parseDriverFile('{nope')).toThrow(/valid JSON/);
    expect(() => parseDriverFile('x'.repeat(3 * 1024 * 1024))).toThrow(/too large/);
    expect(() => parseDriverFile(JSON.stringify({ schemaVersion: 99 }))).toThrow(/schema/);
    const d = driver();
    expect(() => parseDriverFile(JSON.stringify({ ...d, sensors: { ...d.sensors, rayCount: 5 } }))).toThrow(
      /inputs/,
    );
    expect(() =>
      parseDriverFile(JSON.stringify({ ...d, brain: { ...d.brain, genome: d.brain.genome.slice(1) } })),
    ).toThrow();
  });

  it('neutralises hostile strings and ids', () => {
    const d = parseDriverFile(
      JSON.stringify({ ...driver(), id: '../../etc', name: '<img src=x onerror=alert(1)>'.repeat(50) }),
    );
    expect(d.id).not.toBe('../../etc');
    expect(d.name.length).toBeLessThanOrEqual(80);
  });

  it('rejects checkpoints whose genomes do not match the architecture', () => {
    const cfg = defaultConfig();
    expect(() => validateTrainingState({ genomes: [[1, 2, 3]] }, cfg)).toThrow(/numbers/);
    expect(() => validateTrainingState({ genomes: [] }, cfg)).toThrow(/1–400/);
  });
});

describe('database', () => {
  it('stores and reads drivers without overwriting existing ids', async () => {
    await db.add('drivers', driver());
    await expect(db.add('drivers', driver())).rejects.toThrow(/already exists/);
    const all = await db.getAll('drivers');
    expect(all.items).toHaveLength(1);
    expect((await db.get('drivers', 'd1'))?.name).toBe('Test driver');
    await db.remove('drivers', 'd1');
    expect(await db.get('drivers', 'd1')).toBeNull();
  });

  it('skips corrupt records instead of failing', async () => {
    await db.add('drivers', driver('good'));
    await db.put('drivers', { id: 'bad', schemaVersion: 1 } as unknown as DriverRecord);
    const all = await db.getAll('drivers');
    expect(all.items.map((d) => d.id)).toEqual(['good']);
    expect(all.corrupt).toEqual(['bad']);
  });

  it('keeps one auto checkpoint per experiment and never touches manual ones', async () => {
    const cfg = defaultConfig();
    cfg.genetic.populationSize = 10;
    const state = new Session({ mode: 'train', config: cfg }).exportState();
    const cp = (id: string, kind: 'auto' | 'manual'): CheckpointRecord => ({
      id,
      experimentId: 'e1',
      experimentName: 'E',
      createdAt: 1,
      kind,
      generation: 0,
      config: cfg,
      state,
    });
    await db.add('checkpoints', cp('m1', 'manual'));
    await db.saveAutoCheckpoint(cp('a1', 'auto'));
    await db.saveAutoCheckpoint(cp('a2', 'auto'));
    const ids = (await db.getAll('checkpoints')).items.map((c) => c.id).sort();
    expect(ids).toEqual(['a2', 'm1']);
    const restored = (await db.get('checkpoints', 'a2'))!;
    expect(Array.from(restored.state.genomes[0]!)).toEqual(Array.from(state.genomes[0]!));
  });

  it('round-trips a backup and imports conflicting ids under new ids', async () => {
    await db.add('drivers', driver());
    const json = await db.exportBackup();
    const summary = await db.importBackup(json);
    expect(summary).toEqual({ imported: 1, renamed: 1, rejected: 0 });
    expect((await db.getAll('drivers')).items).toHaveLength(2);
    await expect(db.importBackup('{"format":"other"}')).rejects.toThrow(/not an Autopilot Lab backup/);
  });
});
