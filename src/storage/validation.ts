import { deserializeBrain, genomeLength, serializeBrain, type SerializedBrain } from '../ai/network';
import type { BestEver, GenerationStats, TestResult, TrainingState } from '../engine/session';
import {
  networkLayers,
  sanitizeConfig,
  type EnvironmentConfig,
  type SensorConfig,
  type SimConfig,
} from '../simulation/config';

export const SCHEMA_VERSION = 1;
export const MAX_DRIVER_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_BACKUP_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT = 500;

export interface DriverRecord {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  /** Incremented every time the driver's metadata is edited. */
  version: number;
  createdAt: number;
  updatedAt: number;
  generation: number;
  fitness: number;
  bestDistance: number;
  brain: SerializedBrain;
  sensors: SensorConfig;
  trainingConfig: SimConfig;
  source: 'training' | 'import' | 'duplicate';
}

export interface ExperimentRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: SimConfig;
  history: GenerationStats[];
  bestFitness: number;
  bestDistance: number;
}

export interface CheckpointRecord {
  id: string;
  experimentId: string;
  experimentName: string;
  createdAt: number;
  kind: 'auto' | 'manual';
  generation: number;
  config: SimConfig;
  state: TrainingState;
}

export interface BenchmarkRecord {
  id: string;
  createdAt: number;
  scenario: EnvironmentConfig;
  results: TestResult[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : fallback);
const id = (v: unknown): string => {
  const s = text(v);
  return /^[\w-]{1,64}$/.test(s) ? s : newId();
};

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Parses JSON text with a size limit. Throws an Error with a user-readable message. */
export function parseJson(raw: string, maxBytes: number): unknown {
  if (raw.length > maxBytes)
    throw new Error(`File is too large (limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB).`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('File is not valid JSON.');
  }
}

export function validateDriver(data: unknown): DriverRecord {
  if (!isObj(data)) throw new Error('Driver must be a JSON object.');
  const schema = finite(data.schemaVersion, -1);
  if (schema < 1 || schema > SCHEMA_VERSION)
    throw new Error(
      `Unsupported driver schema version ${String(data.schemaVersion)} (supported: 1–${SCHEMA_VERSION}).`,
    );
  const brain = deserializeBrain(data.brain);
  const trainingConfig = sanitizeConfig(data.trainingConfig);
  const sensors = sanitizeConfig({ sensors: data.sensors }).sensors;
  if (brain.layers[0] !== sensors.rayCount + 1)
    throw new Error(
      `Driver brain expects ${brain.layers[0]} inputs but its sensors provide ${sensors.rayCount + 1}.`,
    );
  if (brain.layers[brain.layers.length - 1] !== 4)
    throw new Error('Driver brain must have exactly 4 outputs.');
  const now = Date.now();
  const source = data.source === 'import' || data.source === 'duplicate' ? data.source : 'training';
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id(data.id),
    name: text(data.name, 'Unnamed driver').trim().slice(0, 80) || 'Unnamed driver',
    description: text(data.description),
    version: Math.max(1, Math.round(finite(data.version, 1))),
    createdAt: finite(data.createdAt, now),
    updatedAt: finite(data.updatedAt, now),
    generation: Math.max(0, Math.round(finite(data.generation))),
    fitness: finite(data.fitness),
    bestDistance: Math.max(0, finite(data.bestDistance)),
    brain: serializeBrain(brain),
    sensors,
    trainingConfig,
    source,
  };
}

export const DRIVER_FILE_FORMAT = 'autopilot-lab/driver';

/** Accepts either an exported driver file ({format, driver}) or a bare driver object. */
export function parseDriverFile(raw: string): DriverRecord {
  const data = parseJson(raw, MAX_DRIVER_FILE_BYTES);
  const inner = isObj(data) && data.format === DRIVER_FILE_FORMAT ? data.driver : data;
  return validateDriver(inner);
}

function validateStats(v: unknown): GenerationStats | null {
  if (!isObj(v)) return null;
  const n = (k: string) => finite(v[k]);
  return {
    generation: Math.max(0, Math.round(n('generation'))),
    bestFitness: n('bestFitness'),
    avgFitness: n('avgFitness'),
    bestDistance: n('bestDistance'),
    avgDistance: n('avgDistance'),
    avgSpeed: n('avgSpeed'),
    survivalRate: Math.min(1, Math.max(0, n('survivalRate'))),
    collisions: Math.max(0, Math.round(n('collisions'))),
    stalled: Math.max(0, Math.round(n('stalled'))),
    finished: Math.max(0, Math.round(n('finished'))),
    diversity: n('diversity'),
    mutationRate: n('mutationRate'),
    simSeconds: n('simSeconds'),
    wallMs: n('wallMs'),
    timestamp: n('timestamp'),
  };
}

export function validateHistory(v: unknown): GenerationStats[] {
  return Array.isArray(v)
    ? v
        .slice(0, 5000)
        .map(validateStats)
        .filter((s): s is GenerationStats => !!s)
    : [];
}

function toGenome(v: unknown, len: number, what: string): Float64Array {
  if (!(Array.isArray(v) || v instanceof Float64Array) || v.length !== len)
    throw new Error(`${what} must contain ${len} numbers for this network architecture.`);
  const g = Float64Array.from(v as ArrayLike<number>);
  if (!g.every(Number.isFinite)) throw new Error(`${what} contains non-finite values.`);
  return g;
}

/** Validates a training checkpoint against the network shape implied by `config`. */
export function validateTrainingState(data: unknown, config: SimConfig): TrainingState {
  if (!isObj(data)) throw new Error('Checkpoint state is missing or malformed.');
  const len = genomeLength(networkLayers(config));
  if (!Array.isArray(data.genomes) || data.genomes.length < 1 || data.genomes.length > 400)
    throw new Error('Checkpoint population must contain 1–400 genomes.');
  const genomes = data.genomes.map((g, i) => toGenome(g, len, `Genome #${i}`));
  let bestEver: BestEver | null = null;
  if (isObj(data.bestEver)) {
    bestEver = {
      genome: toGenome(data.bestEver.genome, len, 'Best-ever genome'),
      fitness: finite(data.bestEver.fitness),
      distance: finite(data.bestEver.distance),
      generation: Math.max(0, Math.round(finite(data.bestEver.generation))),
    };
  }
  return {
    generation: Math.max(0, Math.round(finite(data.generation))),
    genomes,
    bestEver,
    rngState: Math.round(finite(data.rngState)) >>> 0,
    mutationRate: Math.min(0.5, Math.max(0, finite(data.mutationRate, config.genetic.mutationRate))),
    stagnant: Math.max(0, Math.round(finite(data.stagnant))),
    trainingSimSeconds: Math.max(0, finite(data.trainingSimSeconds)),
    history: validateHistory(data.history),
  };
}

export function validateCheckpoint(data: unknown): CheckpointRecord {
  if (!isObj(data)) throw new Error('Checkpoint must be an object.');
  const config = sanitizeConfig(data.config);
  return {
    id: id(data.id),
    experimentId: id(data.experimentId),
    experimentName: text(data.experimentName, 'Experiment'),
    createdAt: finite(data.createdAt, Date.now()),
    kind: data.kind === 'auto' ? 'auto' : 'manual',
    generation: Math.max(0, Math.round(finite(data.generation))),
    config,
    state: validateTrainingState(data.state, config),
  };
}

export function validateExperiment(data: unknown): ExperimentRecord {
  if (!isObj(data)) throw new Error('Experiment must be an object.');
  return {
    id: id(data.id),
    name: text(data.name, 'Experiment').slice(0, 80),
    createdAt: finite(data.createdAt, Date.now()),
    updatedAt: finite(data.updatedAt, Date.now()),
    config: sanitizeConfig(data.config),
    history: validateHistory(data.history),
    bestFitness: finite(data.bestFitness),
    bestDistance: finite(data.bestDistance),
  };
}

const STATUSES = ['alive', 'crashed', 'stalled', 'finished', 'timeout'] as const;

export function validateBenchmark(data: unknown): BenchmarkRecord {
  if (!isObj(data) || !Array.isArray(data.results)) throw new Error('Benchmark must have results.');
  return {
    id: id(data.id),
    createdAt: finite(data.createdAt, Date.now()),
    scenario: sanitizeConfig({ env: data.scenario }).env,
    results: data.results
      .slice(0, 50)
      .filter(isObj)
      .map((r) => ({
        driverId: text(r.driverId),
        driverName: text(r.driverName, 'Driver'),
        status: STATUSES.includes(r.status as (typeof STATUSES)[number])
          ? (r.status as TestResult['status'])
          : 'timeout',
        distance: finite(r.distance),
        time: finite(r.time),
        avgSpeed: finite(r.avgSpeed),
        checkpoints: finite(r.checkpoints),
        laneDeviation: finite(r.laneDeviation),
        fitness: finite(r.fitness),
      })),
  };
}

/** Converts typed arrays to plain arrays so checkpoints survive JSON export. */
export function checkpointToJson(c: CheckpointRecord): unknown {
  return {
    ...c,
    state: {
      ...c.state,
      genomes: c.state.genomes.map((g) => Array.from(g)),
      bestEver: c.state.bestEver && { ...c.state.bestEver, genome: Array.from(c.state.bestEver.genome) },
    },
  };
}
