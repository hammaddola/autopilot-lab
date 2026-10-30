import { clamp } from '../core/geometry';

export type EnvPreset = 'highway' | 'urban' | 'curved' | 'obstacles' | 'dense' | 'challenge';
export type RoadLayout = 'straight' | 'curved' | 'urban';
export type TrafficPattern = 'random' | 'staggered' | 'platoon';
export type SimMode = 'train' | 'test' | 'manual';

export interface EnvironmentConfig {
  preset: EnvPreset;
  layout: RoadLayout;
  seed: number;
  laneCount: number;
  laneWidth: number;
  /** 0..1 */
  trafficDensity: number;
  /** Traffic speed as a fraction of the vehicle's max speed. */
  trafficSpeed: number;
  /** 0..1 density of static obstacles. */
  obstacleDensity: number;
  pattern: TrafficPattern;
  roadLength: number;
}

export interface SensorConfig {
  rayCount: number;
  range: number;
  /** Field of view in degrees. */
  fov: number;
}

export interface PhysicsConfig {
  maxSpeed: number;
  acceleration: number;
  brakeDeceleration: number;
  friction: number;
  steerRate: number;
  maxReverseSpeed: number;
}

export interface FitnessWeights {
  distance: number;
  checkpoints: number;
  speed: number;
  time: number;
  collision: number;
  lane: number;
}

export interface GeneticConfig {
  populationSize: number;
  mutationRate: number;
  mutationStrength: number;
  eliteFraction: number;
  tournamentSize: number;
  crossoverRate: number;
  adaptiveMutation: boolean;
  seed: number;
  maxGenerationSeconds: number;
  stallSeconds: number;
  autoCheckpointEvery: number;
}

export interface SimConfig {
  env: EnvironmentConfig;
  sensors: SensorConfig;
  physics: PhysicsConfig;
  genetic: GeneticConfig;
  fitness: FitnessWeights;
  hiddenLayers: number[];
}

type PresetEnv = Omit<EnvironmentConfig, 'seed' | 'roadLength'>;

export const PRESETS: Record<EnvPreset, { label: string; description: string; env: PresetEnv }> = {
  highway: {
    label: 'Highway',
    description: 'Straight three-lane highway with moderate traffic.',
    env: {
      preset: 'highway',
      layout: 'straight',
      laneCount: 3,
      laneWidth: 60,
      trafficDensity: 0.45,
      trafficSpeed: 0.55,
      obstacleDensity: 0,
      pattern: 'random',
    },
  },
  urban: {
    label: 'Urban streets',
    description: 'Narrow two-lane streets with sharp bends and slow, staggered traffic.',
    env: {
      preset: 'urban',
      layout: 'urban',
      laneCount: 2,
      laneWidth: 50,
      trafficDensity: 0.55,
      trafficSpeed: 0.35,
      obstacleDensity: 0,
      pattern: 'staggered',
    },
  },
  curved: {
    label: 'Curved highway',
    description: 'Sweeping curves that test steering and sensor coverage.',
    env: {
      preset: 'curved',
      layout: 'curved',
      laneCount: 3,
      laneWidth: 60,
      trafficDensity: 0.4,
      trafficSpeed: 0.5,
      obstacleDensity: 0,
      pattern: 'random',
    },
  },
  obstacles: {
    label: 'Obstacle course',
    description: 'Static barriers in some lanes with light traffic in a reserved lane.',
    env: {
      preset: 'obstacles',
      layout: 'straight',
      laneCount: 3,
      laneWidth: 60,
      trafficDensity: 0.25,
      trafficSpeed: 0.45,
      obstacleDensity: 0.6,
      pattern: 'random',
    },
  },
  dense: {
    label: 'Dense traffic',
    description: 'Four lanes of heavy platooned traffic.',
    env: {
      preset: 'dense',
      layout: 'straight',
      laneCount: 4,
      laneWidth: 58,
      trafficDensity: 0.85,
      trafficSpeed: 0.5,
      obstacleDensity: 0,
      pattern: 'platoon',
    },
  },
  challenge: {
    label: 'Challenge mode',
    description: 'Curves, obstacles and dense mixed-speed traffic combined.',
    env: {
      preset: 'challenge',
      layout: 'curved',
      laneCount: 3,
      laneWidth: 56,
      trafficDensity: 0.7,
      trafficSpeed: 0.5,
      obstacleDensity: 0.4,
      pattern: 'random',
    },
  },
};

export function presetEnv(preset: EnvPreset, seed = 1337): EnvironmentConfig {
  return { ...PRESETS[preset].env, seed, roadLength: 30000 };
}

export function defaultConfig(): SimConfig {
  return {
    env: presetEnv('highway'),
    sensors: { rayCount: 7, range: 170, fov: 108 },
    physics: {
      maxSpeed: 300,
      acceleration: 220,
      brakeDeceleration: 520,
      friction: 60,
      steerRate: 2.4,
      maxReverseSpeed: 90,
    },
    genetic: {
      populationSize: 120,
      mutationRate: 0.1,
      mutationStrength: 0.5,
      eliteFraction: 0.05,
      tournamentSize: 4,
      crossoverRate: 0.7,
      adaptiveMutation: true,
      seed: 42,
      maxGenerationSeconds: 60,
      stallSeconds: 3,
      autoCheckpointEvery: 5,
    },
    fitness: { distance: 1, checkpoints: 2, speed: 4, time: 5, collision: 10, lane: 2 },
    hiddenLayers: [8],
  };
}

const ENV_PRESETS = Object.keys(PRESETS) as EnvPreset[];
const LAYOUTS: RoadLayout[] = ['straight', 'curved', 'urban'];
const PATTERNS: TrafficPattern[] = ['random', 'staggered', 'platoon'];

function num(v: unknown, fallback: number, lo: number, hi: number, integer = false): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const c = clamp(n, lo, hi);
  return integer ? Math.round(c) : c;
}
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/**
 * Coerces untrusted input (imports, worker messages, saved settings) into a valid config.
 * Unknown/invalid values fall back to defaults; numbers are clamped to safe boundaries.
 */
export function sanitizeConfig(input: unknown): SimConfig {
  const d = defaultConfig();
  const i = obj(input);
  const e = obj(i.env),
    s = obj(i.sensors),
    p = obj(i.physics),
    g = obj(i.genetic),
    f = obj(i.fitness);
  const hidden = Array.isArray(i.hiddenLayers) ? (i.hiddenLayers as unknown[]) : d.hiddenLayers;
  return {
    env: {
      preset: oneOf(e.preset, ENV_PRESETS, d.env.preset),
      layout: oneOf(e.layout, LAYOUTS, d.env.layout),
      seed: num(e.seed, d.env.seed, 0, 2 ** 31 - 1, true),
      laneCount: num(e.laneCount, d.env.laneCount, 2, 6, true),
      laneWidth: num(e.laneWidth, d.env.laneWidth, 44, 90, true),
      trafficDensity: num(e.trafficDensity, d.env.trafficDensity, 0, 1),
      trafficSpeed: num(e.trafficSpeed, d.env.trafficSpeed, 0.2, 0.9),
      obstacleDensity: num(e.obstacleDensity, d.env.obstacleDensity, 0, 1),
      pattern: oneOf(e.pattern, PATTERNS, d.env.pattern),
      roadLength: num(e.roadLength, d.env.roadLength, 2000, 100000, true),
    },
    sensors: {
      rayCount: num(s.rayCount, d.sensors.rayCount, 1, 16, true),
      range: num(s.range, d.sensors.range, 50, 500, true),
      fov: num(s.fov, d.sensors.fov, 10, 300, true),
    },
    physics: {
      maxSpeed: num(p.maxSpeed, d.physics.maxSpeed, 100, 600),
      acceleration: num(p.acceleration, d.physics.acceleration, 50, 800),
      brakeDeceleration: num(p.brakeDeceleration, d.physics.brakeDeceleration, 100, 1500),
      friction: num(p.friction, d.physics.friction, 0, 300),
      steerRate: num(p.steerRate, d.physics.steerRate, 0.5, 6),
      maxReverseSpeed: num(p.maxReverseSpeed, d.physics.maxReverseSpeed, 0, 200),
    },
    genetic: {
      populationSize: num(g.populationSize, d.genetic.populationSize, 10, 400, true),
      mutationRate: num(g.mutationRate, d.genetic.mutationRate, 0, 0.5),
      mutationStrength: num(g.mutationStrength, d.genetic.mutationStrength, 0.01, 2),
      eliteFraction: num(g.eliteFraction, d.genetic.eliteFraction, 0, 0.5),
      tournamentSize: num(g.tournamentSize, d.genetic.tournamentSize, 2, 16, true),
      crossoverRate: num(g.crossoverRate, d.genetic.crossoverRate, 0, 1),
      adaptiveMutation:
        typeof g.adaptiveMutation === 'boolean' ? g.adaptiveMutation : d.genetic.adaptiveMutation,
      seed: num(g.seed, d.genetic.seed, 0, 2 ** 31 - 1, true),
      maxGenerationSeconds: num(g.maxGenerationSeconds, d.genetic.maxGenerationSeconds, 5, 600, true),
      stallSeconds: num(g.stallSeconds, d.genetic.stallSeconds, 0.5, 30),
      autoCheckpointEvery: num(g.autoCheckpointEvery, d.genetic.autoCheckpointEvery, 0, 100, true),
    },
    fitness: {
      distance: num(f.distance, d.fitness.distance, 0, 100),
      checkpoints: num(f.checkpoints, d.fitness.checkpoints, 0, 100),
      speed: num(f.speed, d.fitness.speed, 0, 100),
      time: num(f.time, d.fitness.time, 0, 100),
      collision: num(f.collision, d.fitness.collision, 0, 1000),
      lane: num(f.lane, d.fitness.lane, 0, 100),
    },
    hiddenLayers: (hidden.length ? hidden : d.hiddenLayers).slice(0, 4).map((h) => num(h, 8, 1, 32, true)),
  };
}

/** Network layer sizes implied by the config: rays + speed → hidden… → 4 controls. */
export function networkLayers(cfg: Pick<SimConfig, 'sensors' | 'hiddenLayers'>): number[] {
  return [cfg.sensors.rayCount + 1, ...cfg.hiddenLayers, 4];
}

/** Simulation units: 1 unit = 0.1 m, so u/s × 0.36 = km/h. */
export const UNIT_TO_KMH = 0.36;
export const CHECKPOINT_SPACING = 500;
export const FIXED_DT = 1 / 60;
