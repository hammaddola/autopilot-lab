import { deserializeBrain, type Brain } from '../ai/network';
import type { GenerationStats, TestResult, TrainingState } from '../engine/session';
import { networkLayers, sanitizeConfig, type SimConfig, type SimMode } from '../simulation/config';
import * as db from '../storage/db';
import {
  newId,
  SCHEMA_VERSION,
  type CheckpointRecord,
  type DriverRecord,
  type ExperimentRecord,
} from '../storage/validation';
import { toast } from '../ui/components/feedback';
import { isResponse, type SimSpeed, type WorkerRequest, type WorkerResponse } from '../workers/protocol';
import { loadLastConfig, saveLastConfig } from './preferences';

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished' | 'crashed' | 'error';
export type FrameMessage = Extract<WorkerResponse, { type: 'frame' }>;

interface StartOptions {
  drivers?: DriverRecord[];
  checkpoint?: CheckpointRecord;
  experimentName?: string;
  autoplay?: boolean;
}

export interface PerfStats {
  fps: number;
  renderMs: number;
  stepsPerSecond: number;
  workerMs: number;
  vehicles: number;
}

/**
 * Main-thread owner of the simulation worker. Pages read state from here and subscribe to events:
 * 'frame' (new snapshot), 'status', 'generation', 'checkpoint' (after one is stored), 'results', 'config',
 * 'session'.
 */
export class SimController extends EventTarget {
  /** Draft configuration edited by the UI; applied when a session starts. */
  config: SimConfig = loadLastConfig();
  /** Configuration of the running session. */
  activeConfig: SimConfig | null = null;
  mode: SimMode = 'train';
  status: RunStatus = 'idle';
  speed: SimSpeed = 1;
  frame: FrameMessage | null = null;
  focusBrain: Brain | null = null;
  experiment: ExperimentRecord | null = null;
  testDrivers: DriverRecord[] = [];
  testResults: TestResult[] | null = null;
  manualCrash: string | null = null;
  lastError: string | null = null;
  trainingStartedAt = 0;
  /** Most recently stored checkpoint, set just before the 'checkpoint' event. */
  lastCheckpoint: CheckpointRecord | null = null;
  readonly perf: PerfStats = { fps: 0, renderMs: 0, stepsPerSecond: 0, workerMs: 0, vehicles: 0 };

  private worker: Worker | null = null;
  private lastOptions: StartOptions = {};
  private requestSeq = 0;
  private pending = new Map<number, (s: TrainingState | null) => void>();
  private lastInput = '';
  private storageWarned = false;
  private starting: Promise<void> | null = null;

  private emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }

  on(type: string, fn: () => void): () => void {
    this.addEventListener(type, fn);
    return () => this.removeEventListener(type, fn);
  }

  get hasSession(): boolean {
    return this.worker !== null;
  }

  setConfig(c: SimConfig): void {
    this.config = sanitizeConfig(c);
    saveLastConfig(this.config);
    this.emit('config');
  }

  private post(msg: WorkerRequest): void {
    this.worker?.postMessage(msg);
  }

  private setStatus(s: RunStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('status');
  }

  /**
   * Starts a new session in the given mode (terminating any previous one). Calls made while a start is
   * still awaiting storage are ignored, so a double-click cannot spawn two workers or two experiments.
   */
  start(mode: SimMode, opts: StartOptions = {}): Promise<void> {
    this.starting ??= this.doStart(mode, opts).finally(() => (this.starting = null));
    return this.starting;
  }

  private async doStart(mode: SimMode, opts: StartOptions): Promise<void> {
    // Leaving a training run: checkpoint it first so the best driver is never lost.
    if (this.mode === 'train' && this.worker) await this.saveCheckpoint('auto', true);
    this.terminate();
    this.mode = mode;
    this.lastOptions = opts;
    this.testResults = null;
    this.manualCrash = null;
    this.lastError = null;
    this.frame = null;
    this.focusBrain = null;
    const config = opts.checkpoint ? opts.checkpoint.config : this.config;
    if (opts.checkpoint) this.setConfig(config);
    this.activeConfig = structuredClone(config);

    if (mode === 'train') await this.prepareExperiment(opts);
    if (mode === 'test') this.testDrivers = opts.drivers ?? [];

    const worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      if (this.worker !== worker) return;
      if (isResponse(e.data)) this.handle(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      if (this.worker !== worker) return;
      this.fail(`The simulation worker crashed (${e.message || 'unknown error'}).`);
    };
    worker.onmessageerror = () => this.fail('Received unreadable data from the simulation worker.');

    this.post({
      type: 'init',
      mode,
      config,
      drivers: opts.drivers?.map((d) => ({ id: d.id, name: d.name, brain: d.brain, sensors: d.sensors })),
      state: opts.checkpoint?.state,
      autoplay: opts.autoplay ?? true,
    });
    this.post({ type: 'speed', value: this.speed });
    this.trainingStartedAt = Date.now();
    this.setStatus(opts.autoplay === false ? 'paused' : 'running');
    this.emit('session');
  }

  private async prepareExperiment(opts: StartOptions): Promise<void> {
    if (opts.checkpoint) {
      const existing = await db.get('experiments', opts.checkpoint.experimentId).catch(() => null);
      if (existing) {
        // Rewind the experiment's history to the checkpoint so later generations aren't duplicated.
        existing.history = opts.checkpoint.state.history.slice();
        this.experiment = existing;
        await this.persistExperiment();
        return;
      }
    }
    await db.pruneAutoCheckpoints().catch(() => 0);
    const now = Date.now();
    this.experiment = {
      id: opts.checkpoint?.experimentId ?? newId(),
      name:
        opts.experimentName ??
        `Experiment ${new Date(now).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`,
      createdAt: now,
      updatedAt: now,
      config: structuredClone(opts.checkpoint?.config ?? this.config),
      history: opts.checkpoint?.state.history.slice() ?? [],
      bestFitness: 0,
      bestDistance: 0,
    };
    await this.persistExperiment();
  }

  private async persistExperiment(): Promise<void> {
    if (!this.experiment) return;
    const e = this.experiment;
    e.updatedAt = Date.now();
    e.bestFitness = Math.max(0, ...e.history.map((h) => h.bestFitness));
    e.bestDistance = Math.max(0, ...e.history.map((h) => h.bestDistance));
    await db.put('experiments', e).catch((err: Error) => this.storageFailed(err));
  }

  private storageFailed(err: Error): void {
    if (this.storageWarned) return;
    this.storageWarned = true;
    toast(`${err.message} Training continues, but progress is not being saved.`, 'warning', undefined, 10000);
  }

  private handle(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'frame':
        this.frame = msg;
        if (msg.focusBrain) {
          try {
            this.focusBrain = deserializeBrain(msg.focusBrain);
          } catch {
            this.focusBrain = null;
          }
        }
        this.perf.stepsPerSecond = msg.perf.stepsPerSecond;
        this.perf.workerMs = msg.perf.workerMs;
        this.perf.vehicles = msg.stats.alive + msg.traffic.length / 4;
        this.emit('frame');
        break;
      case 'generation':
        void this.onGeneration(msg.stats, msg.state);
        break;
      case 'testComplete':
        this.testResults = msg.results;
        this.setStatus('finished');
        void db
          .add('benchmarks', {
            id: newId(),
            createdAt: Date.now(),
            scenario: structuredClone(this.activeConfig!.env),
            results: msg.results,
          })
          .catch((err: Error) => this.storageFailed(err));
        this.emit('results');
        break;
      case 'manualCrash':
        this.manualCrash = msg.cause ?? 'unknown';
        this.setStatus('crashed');
        break;
      case 'state':
        this.pending.get(msg.requestId)?.(msg.state);
        this.pending.delete(msg.requestId);
        break;
      case 'error':
        this.lastError = msg.message;
        toast(msg.message, 'error');
        if (/Simulation error|expects/.test(msg.message)) this.setStatus('error');
        break;
      case 'ready':
        break;
    }
  }

  private async onGeneration(stats: GenerationStats, state: TrainingState | null): Promise<void> {
    if (!this.experiment) return;
    this.experiment.history.push(stats);
    this.emit('generation');
    await this.persistExperiment();
    if (state) await this.storeCheckpoint(state, 'auto');
  }

  private fail(message: string): void {
    this.lastError = message;
    this.worker?.terminate();
    this.worker = null;
    this.setStatus('error');
    toast(
      message,
      'error',
      this.mode === 'train' && this.experiment
        ? { label: 'Resume from checkpoint', run: () => void this.resumeLatest() }
        : undefined,
    );
  }

  /** Restarts training from the experiment's most recent checkpoint (used after a worker crash). */
  async resumeLatest(): Promise<void> {
    const id = this.experiment?.id;
    const all = await db.getAll('checkpoints').catch(() => ({ items: [] as CheckpointRecord[] }));
    const latest = all.items
      .filter((c) => c.experimentId === id)
      .sort((a, b) => b.generation - a.generation)[0];
    if (latest) await this.start('train', { checkpoint: latest });
    else {
      toast('No checkpoint found for this experiment; starting a fresh run.', 'warning');
      await this.start('train');
    }
  }

  play(): void {
    if (!this.worker || this.status === 'finished' || this.status === 'crashed') return;
    this.post({ type: 'control', action: 'play' });
    this.setStatus('running');
  }

  pause(): void {
    if (!this.worker) return;
    this.post({ type: 'control', action: 'pause' });
    this.setStatus('paused');
  }

  step(): void {
    if (!this.worker) return;
    this.post({ type: 'control', action: 'step' });
    this.setStatus('paused');
  }

  nextGeneration(): void {
    if (this.mode === 'train') this.post({ type: 'control', action: 'nextGeneration' });
  }

  setSpeed(v: SimSpeed): void {
    this.speed = v;
    this.post({ type: 'speed', value: v });
    this.emit('status');
  }

  setFocus(index: number): void {
    this.post({ type: 'focus', index });
  }

  setInput(throttle: number, brake: number, steer: number): void {
    const key = `${throttle}|${brake}|${steer}`;
    if (key === this.lastInput) return;
    this.lastInput = key;
    this.post({ type: 'input', throttle, brake, steer });
  }

  /** Re-runs the current mode with the same options (fresh scenario episode). */
  async restart(): Promise<void> {
    const opts = { ...this.lastOptions };
    if (this.mode === 'train') delete opts.checkpoint;
    if (this.mode === 'test') opts.drivers = this.testDrivers;
    await this.start(this.mode, opts);
  }

  /**
   * Stops the session. Training state is checkpointed first so the best driver is never lost.
   * Resolves to whether a checkpoint was stored.
   */
  async stop(): Promise<boolean> {
    const saved = this.mode === 'train' && !!this.worker && (await this.saveCheckpoint('auto', true));
    this.terminate();
    this.setStatus('idle');
    this.emit('session');
    return saved;
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }

  requestState(): Promise<TrainingState | null> {
    if (!this.worker || this.mode !== 'train') return Promise.resolve(null);
    const id = ++this.requestSeq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'requestState', requestId: id });
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null);
      }, 5000);
    });
  }

  private async storeCheckpoint(
    state: TrainingState,
    kind: 'auto' | 'manual',
  ): Promise<CheckpointRecord | null> {
    if (!this.experiment || !this.activeConfig) return null;
    const record: CheckpointRecord = {
      id: newId(),
      experimentId: this.experiment.id,
      experimentName: this.experiment.name,
      createdAt: Date.now(),
      kind,
      generation: state.generation,
      config: structuredClone(this.activeConfig),
      state,
    };
    try {
      if (kind === 'auto') await db.saveAutoCheckpoint(record);
      else await db.add('checkpoints', record);
      this.lastCheckpoint = record;
      this.emit('checkpoint');
      return record;
    } catch (err) {
      this.storageFailed(err as Error);
      return null;
    }
  }

  async saveCheckpoint(kind: 'auto' | 'manual' = 'manual', quiet = false): Promise<boolean> {
    const state = await this.requestState();
    if (!state) {
      if (!quiet) toast('No training session to checkpoint.', 'warning');
      return false;
    }
    const saved = await this.storeCheckpoint(state, kind);
    if (saved && !quiet) toast(`Checkpoint saved at generation ${state.generation}.`, 'success');
    return !!saved;
  }

  /** Saves the best-ever trained brain to the driver library. */
  async saveBestDriver(name: string, description: string): Promise<DriverRecord | null> {
    const state = await this.requestState();
    if (!state?.bestEver || !this.activeConfig) {
      toast('No completed generation yet — let training finish at least one generation first.', 'warning');
      return null;
    }
    const now = Date.now();
    const cfg = this.activeConfig;
    const driver: DriverRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: newId(),
      name,
      description,
      version: 1,
      createdAt: now,
      updatedAt: now,
      generation: state.bestEver.generation,
      fitness: state.bestEver.fitness,
      bestDistance: state.bestEver.distance,
      brain: { layers: networkLayers(cfg), genome: Array.from(state.bestEver.genome) },
      sensors: { ...cfg.sensors },
      trainingConfig: structuredClone(cfg),
      source: 'training',
    };
    try {
      await db.add('drivers', driver);
      toast(`Saved "${name}" to the driver library.`, 'success');
      return driver;
    } catch (err) {
      toast((err as Error).message, 'error');
      return null;
    }
  }
}

export const controller = new SimController();
