import { computeFitness, type DriveStats } from '../ai/fitness';
import { adaptiveRate, diversity, evolve } from '../ai/genetic';
import { NetworkRunner, randomBrain, type Brain } from '../ai/network';
import { Rng, deriveSeed } from '../core/rng';
import type { Car, Controls } from '../simulation/car';
import { outputsToControls } from '../simulation/car';
import {
  FIXED_DT,
  networkLayers,
  type SensorConfig,
  type SimConfig,
  type SimMode,
} from '../simulation/config';
import { Road } from '../simulation/road';
import { TRAFFIC_KIND_CODE } from '../simulation/traffic';
import { World } from '../simulation/world';

export interface GenerationStats {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  bestDistance: number;
  avgDistance: number;
  avgSpeed: number;
  survivalRate: number;
  collisions: number;
  stalled: number;
  finished: number;
  diversity: number;
  mutationRate: number;
  simSeconds: number;
  wallMs: number;
  timestamp: number;
}

export interface LiveStats {
  mode: SimMode;
  generation: number;
  simTime: number;
  total: number;
  alive: number;
  eliminated: number;
  collisions: number;
  bestDistance: number;
  avgDistance: number;
  bestFitness: number;
  avgFitness: number;
  avgSpeed: number;
  survivalRate: number;
  mutationRate: number;
  diversity: number;
  bestEverFitness: number;
  trainingSimSeconds: number;
}

export interface TestDriver {
  id: string;
  name: string;
  brain: Brain;
  sensors: SensorConfig;
}

export interface TestResult {
  driverId: string;
  driverName: string;
  status: Car['status'];
  distance: number;
  time: number;
  avgSpeed: number;
  checkpoints: number;
  laneDeviation: number;
  fitness: number;
}

export interface BestEver {
  genome: Float64Array;
  fitness: number;
  distance: number;
  generation: number;
}

/** Everything needed to resume training exactly where it stopped. */
export interface TrainingState {
  generation: number;
  genomes: Float64Array[];
  bestEver: BestEver | null;
  rngState: number;
  mutationRate: number;
  stagnant: number;
  trainingSimSeconds: number;
  history: GenerationStats[];
}

export interface FocusInfo {
  index: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  s: number;
  d: number;
  status: Car['status'];
  readings: number[];
  hits: number[];
  hitKinds: number[];
  controls: Controls;
  activations: number[][] | null;
  sensors: SensorConfig;
}

export const STATUS_CODE: Record<Car['status'], number> = {
  alive: 0,
  crashed: 1,
  stalled: 2,
  finished: 3,
  timeout: 4,
};

export type SessionEvent =
  | { type: 'generation'; stats: GenerationStats; autoCheckpoint: boolean }
  | { type: 'testComplete'; results: TestResult[] }
  | { type: 'manualCrash'; cause: Car['crashedInto'] };

export interface SessionInit {
  mode: SimMode;
  config: SimConfig;
  drivers?: TestDriver[];
  state?: TrainingState;
}

/**
 * Runs one of the three application modes on top of a World. Contains no DOM or worker code so it can run
 * in the Web Worker, in unit tests and in the Node benchmark script alike.
 */
export class Session {
  readonly mode: SimMode;
  readonly config: SimConfig;
  readonly road: Road;
  world!: World;
  focusIndex = 0;
  /** User-selected focus car (test mode); -1 = auto. */
  pinnedFocus = -1;
  readonly manual: Controls = { throttle: 0, brake: 0, steer: 0 };

  // Training state
  generation = 0;
  genomes: Float64Array[] = [];
  bestEver: BestEver | null = null;
  mutationRate: number;
  stagnant = 0;
  trainingSimSeconds = 0;
  history: GenerationStats[] = [];
  private readonly rng: Rng;
  private generationStart = 0;
  private lastDiversity = 0;

  private readonly drivers: TestDriver[];
  private runners: NetworkRunner[] = [];
  private brainLayers: number[][] = [];
  private finished = false;
  private readonly controls: Controls = { throttle: 0, brake: 0, steer: 0 };

  constructor(init: SessionInit) {
    this.mode = init.mode;
    this.config = init.config;
    this.road = new Road(init.config.env);
    this.drivers = init.drivers ?? [];
    this.mutationRate = init.config.genetic.mutationRate;
    this.rng = new Rng(deriveSeed(init.config.genetic.seed, 99));

    if (this.mode === 'train') {
      const layers = networkLayers(init.config);
      if (init.state) this.restore(init.state);
      else {
        const initRng = new Rng(init.config.genetic.seed);
        this.genomes = Array.from(
          { length: init.config.genetic.populationSize },
          () => randomBrain(layers, initRng).genome,
        );
      }
      this.brainLayers = this.genomes.map(() => layers);
      this.runners = [new NetworkRunner(layers)];
    } else if (this.mode === 'test') {
      if (this.drivers.length === 0) throw new Error('Select at least one driver to test.');
      for (const d of this.drivers) {
        if (d.brain.layers[0] !== d.sensors.rayCount + 1)
          throw new Error(
            `Driver "${d.name}" expects ${d.brain.layers[0]} inputs but its sensors provide ${d.sensors.rayCount + 1}.`,
          );
      }
      this.genomes = this.drivers.map((d) => d.brain.genome);
      this.brainLayers = this.drivers.map((d) => d.brain.layers);
      this.runners = this.drivers.map((d) => new NetworkRunner(d.brain.layers));
    }
    this.startEpisode();
  }

  private restore(s: TrainingState): void {
    this.generation = s.generation;
    this.genomes = s.genomes;
    this.bestEver = s.bestEver;
    this.rng.state = s.rngState;
    this.mutationRate = s.mutationRate;
    this.stagnant = s.stagnant;
    this.trainingSimSeconds = s.trainingSimSeconds;
    this.history = s.history.slice();
  }

  exportState(): TrainingState {
    return {
      generation: this.generation,
      genomes: this.genomes.map((g) => g.slice()),
      bestEver: this.bestEver && { ...this.bestEver, genome: this.bestEver.genome.slice() },
      rngState: this.rng.state,
      mutationRate: this.mutationRate,
      stagnant: this.stagnant,
      trainingSimSeconds: this.trainingSimSeconds,
      history: this.history.slice(),
    };
  }

  get isFinished(): boolean {
    return this.finished;
  }

  private startEpisode(): void {
    const g = this.config.genetic;
    const count = this.mode === 'manual' ? 1 : this.genomes.length;
    const opts =
      this.mode === 'manual'
        ? { stallSeconds: Infinity, maxSeconds: Infinity }
        : { stallSeconds: g.stallSeconds, maxSeconds: this.mode === 'train' ? g.maxGenerationSeconds : 600 };
    const sensors = this.mode === 'test' ? this.drivers.map((d) => d.sensors) : undefined;
    this.world = new World(this.config, count, opts, this.road, sensors);
    this.generationStart = Date.now();
    this.lastDiversity = this.mode === 'train' ? diversity(this.genomes) : 0;
    this.finished = false;
  }

  /** Advances one fixed timestep. Returns an event when an episode boundary is crossed. */
  step(): SessionEvent | null {
    if (this.finished) return null;
    const world = this.world;
    this.focusIndex = this.pickFocus();
    world.step(FIXED_DT, this.decide);
    if (this.mode === 'train') this.trainingSimSeconds += FIXED_DT;

    if (this.mode === 'manual') {
      const car = world.cars[0]!;
      if (car.status === 'crashed') {
        this.finished = true;
        return { type: 'manualCrash', cause: car.crashedInto };
      }
      if (!car.alive) this.finished = true;
      return null;
    }
    if (!world.done) return null;
    if (this.mode === 'test') {
      this.finished = true;
      return { type: 'testComplete', results: this.testResults() };
    }
    return this.finishGeneration();
  }

  private readonly decide = (car: Car, i: number): Controls => {
    if (this.mode === 'manual') return this.manual;
    const runner = this.runners.length === 1 ? this.runners[0]! : this.runners[i]!;
    const n = car.readings.length;
    // Inputs: n sensor readings followed by forward speed normalised to [-1, 1].
    const buf = inputScratch;
    for (let k = 0; k < n; k++) buf[k] = car.readings[k]!;
    buf[n] = car.speed / this.config.physics.maxSpeed;
    const out = runner.forward(this.genomes[i]!, buf);
    if (i === this.focusIndex) this.focusActivations = runner.activations.map((a) => Array.from(a));
    return outputsToControls(out, this.controls);
  };

  private focusActivations: number[][] | null = null;

  /** Forces the current training generation to end now (cars still alive count as timed out). */
  forceNextGeneration(): SessionEvent | null {
    if (this.mode !== 'train') return null;
    for (const c of this.world.cars) if (c.alive) c.status = 'timeout';
    return this.finishGeneration();
  }

  private driveStats(car: Car): DriveStats {
    return {
      distance: car.distance,
      checkpoints: this.world.checkpoints(car),
      avgSpeed: car.samples ? car.speedSum / car.samples : 0,
      time: car.time,
      crashed: car.status === 'crashed',
      laneDeviation: car.samples ? car.laneDevSum / car.samples : 0,
    };
  }

  fitnessOf(car: Car): number {
    const episode =
      this.mode === 'train' ? this.config.genetic.maxGenerationSeconds : Math.max(1, this.world.time);
    return computeFitness(this.driveStats(car), this.config.fitness, {
      maxSpeed: this.config.physics.maxSpeed,
      episodeSeconds: episode,
    });
  }

  private finishGeneration(): SessionEvent {
    const cars = this.world.cars;
    const fitness = cars.map((c) => this.fitnessOf(c));
    let best = 0;
    for (let i = 1; i < fitness.length; i++) if (fitness[i]! > fitness[best]!) best = i;
    const n = cars.length;
    const sum = (f: (c: Car, i: number) => number) => cars.reduce((a, c, i) => a + f(c, i), 0);
    const collisions = cars.filter((c) => c.status === 'crashed').length;
    const stats: GenerationStats = {
      generation: this.generation,
      bestFitness: fitness[best]!,
      avgFitness: sum((_, i) => fitness[i]!) / n,
      bestDistance: Math.max(...cars.map((c) => c.distance)),
      avgDistance: sum((c) => c.distance) / n,
      avgSpeed: sum((c) => (c.samples ? c.speedSum / c.samples : 0)) / n,
      // Survivors: reached the time limit or the end of the road (neither crashed nor stalled).
      survivalRate: cars.filter((c) => c.status === 'timeout' || c.status === 'finished').length / n,
      collisions,
      stalled: cars.filter((c) => c.status === 'stalled').length,
      finished: cars.filter((c) => c.status === 'finished').length,
      diversity: this.lastDiversity,
      mutationRate: this.mutationRate,
      simSeconds: this.world.time,
      wallMs: Date.now() - this.generationStart,
      timestamp: Date.now(),
    };
    this.history.push(stats);
    if (this.history.length > 5000) this.history.shift();

    let bestEverInPopulation = false;
    if (!this.bestEver || stats.bestFitness > this.bestEver.fitness + 1e-9) {
      this.bestEver = {
        genome: this.genomes[best]!.slice(),
        fitness: stats.bestFitness,
        distance: cars[best]!.distance,
        generation: this.generation,
      };
      this.stagnant = 0;
      bestEverInPopulation = true;
    } else {
      this.stagnant++;
      // Elite slot 0 carries the best-ever genome; skip the duplicate when it re-scored as this generation's best.
      bestEverInPopulation = arraysEqual(this.genomes[best]!, this.bestEver.genome);
    }

    const g = this.config.genetic;
    const rate = g.adaptiveMutation
      ? adaptiveRate(g.mutationRate, this.lastDiversity, this.stagnant)
      : g.mutationRate;
    this.mutationRate = rate;
    this.genomes = evolve({
      genomes: this.genomes,
      fitness,
      bestEver: this.bestEver.genome,
      bestEverInPopulation,
      config: g,
      rate,
      rng: this.rng,
    });
    this.brainLayers = this.genomes.map(() => this.brainLayers[0]!);
    this.generation++;
    this.startEpisode();
    const autoCheckpoint = g.autoCheckpointEvery > 0 && this.generation % g.autoCheckpointEvery === 0;
    return { type: 'generation', stats, autoCheckpoint };
  }

  private testResults(): TestResult[] {
    return this.world.cars.map((car, i) => {
      const s = this.driveStats(car);
      const d = this.drivers[i]!;
      return {
        driverId: d.id,
        driverName: d.name,
        status: car.status,
        distance: s.distance,
        time: s.time,
        avgSpeed: s.avgSpeed,
        checkpoints: s.checkpoints,
        laneDeviation: s.laneDeviation,
        fitness: this.fitnessOf(car),
      };
    });
  }

  private pickFocus(): number {
    const cars = this.world.cars;
    if (this.pinnedFocus >= 0 && this.pinnedFocus < cars.length) return this.pinnedFocus;
    let best = -1;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]!;
      if (c.alive && (best < 0 || c.loc.s > cars[best]!.loc.s)) best = i;
    }
    return best < 0 ? this.focusIndex : best;
  }

  liveStats(): LiveStats {
    const cars = this.world.cars;
    const n = cars.length;
    let bestD = 0,
      sumD = 0,
      sumSpeed = 0,
      aliveSpeedN = 0,
      bestF = -Infinity,
      sumF = 0,
      collisions = 0,
      finishedOrTimeout = 0;
    const scoreLive = this.mode !== 'manual' && n <= 400;
    for (const c of cars) {
      bestD = Math.max(bestD, c.distance);
      sumD += c.distance;
      if (c.alive) {
        sumSpeed += c.speed;
        aliveSpeedN++;
      }
      if (c.status === 'crashed') collisions++;
      else if (c.status === 'finished' || c.status === 'timeout') finishedOrTimeout++;
      if (scoreLive) {
        const f = this.fitnessOf(c);
        sumF += f;
        if (f > bestF) bestF = f;
      }
    }
    return {
      mode: this.mode,
      generation: this.generation,
      simTime: this.world.time,
      total: n,
      alive: this.world.alive,
      eliminated: n - this.world.alive,
      collisions,
      bestDistance: bestD,
      avgDistance: n ? sumD / n : 0,
      bestFitness: scoreLive ? bestF : 0,
      avgFitness: scoreLive && n ? sumF / n : 0,
      avgSpeed: aliveSpeedN ? sumSpeed / aliveSpeedN : 0,
      survivalRate: n ? 1 - (n - this.world.alive - finishedOrTimeout) / n : 1,
      mutationRate: this.mutationRate,
      diversity: this.lastDiversity,
      bestEverFitness: this.bestEver?.fitness ?? 0,
      trainingSimSeconds: this.trainingSimSeconds,
    };
  }

  /** Packs vehicle poses into flat typed arrays for cheap transfer to the render thread. */
  snapshot(): { cars: Float32Array; traffic: Float32Array } {
    const cars = this.world.cars;
    const out = new Float32Array(cars.length * 4);
    cars.forEach((c, i) => {
      out[i * 4] = c.x;
      out[i * 4 + 1] = c.y;
      out[i * 4 + 2] = c.angle;
      out[i * 4 + 3] = STATUS_CODE[c.status];
    });
    const active = this.world.traffic.active;
    const tr = new Float32Array(active.length * 4);
    active.forEach((v, i) => {
      tr[i * 4] = v.x;
      tr[i * 4 + 1] = v.y;
      tr[i * 4 + 2] = v.angle;
      tr[i * 4 + 3] = TRAFFIC_KIND_CODE[v.kind];
    });
    return { cars: out, traffic: tr };
  }

  focus(): FocusInfo | null {
    const car = this.world.cars[this.focusIndex];
    if (!car) return null;
    return {
      index: this.focusIndex,
      x: car.x,
      y: car.y,
      angle: car.angle,
      speed: car.speed,
      s: car.loc.s,
      d: car.loc.d,
      status: car.status,
      readings: Array.from(car.readings),
      hits: Array.from(car.hits),
      hitKinds: Array.from(car.hitKinds),
      controls: { ...car.controls },
      activations: this.mode === 'manual' ? null : this.focusActivations,
      sensors: this.world.sensors[this.focusIndex]!,
    };
  }

  /** Brain of the focus car (sent to the UI only when it changes). */
  focusBrain(): Brain | null {
    if (this.mode === 'manual') return null;
    const g = this.genomes[this.focusIndex];
    return g ? { layers: this.brainLayers[this.focusIndex]!, genome: g } : null;
  }
}

// Sensor rays are capped at 16 by sanitizeConfig, so 32 slots always fit rays + speed.
const inputScratch = new Float64Array(32);

function arraysEqual(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
