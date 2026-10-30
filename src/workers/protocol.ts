import type { SerializedBrain } from '../ai/network';
import type { FocusInfo, GenerationStats, LiveStats, TestResult, TrainingState } from '../engine/session';
import type { SensorConfig, SimConfig, SimMode } from '../simulation/config';

export const SPEEDS = [1, 2, 5, 10] as const;
export type SimSpeed = (typeof SPEEDS)[number];

export interface DriverPayload {
  id: string;
  name: string;
  brain: SerializedBrain;
  sensors: SensorConfig;
}

export type WorkerRequest =
  | {
      type: 'init';
      mode: SimMode;
      config: SimConfig;
      drivers?: DriverPayload[];
      state?: TrainingState;
      autoplay: boolean;
    }
  | { type: 'control'; action: 'play' | 'pause' | 'step' | 'nextGeneration' }
  | { type: 'speed'; value: SimSpeed }
  | { type: 'input'; throttle: number; brake: number; steer: number }
  | { type: 'focus'; index: number }
  | { type: 'requestState'; requestId: number };

export interface PerfInfo {
  stepsPerSecond: number;
  /** Mean worker time per tick (ms). */
  workerMs: number;
}

export type WorkerResponse =
  | { type: 'ready'; mode: SimMode }
  | {
      type: 'frame';
      cars: Float32Array;
      traffic: Float32Array;
      focus: FocusInfo | null;
      focusBrain: SerializedBrain | null;
      stats: LiveStats;
      perf: PerfInfo;
    }
  | { type: 'generation'; stats: GenerationStats; state: TrainingState | null }
  | { type: 'testComplete'; results: TestResult[] }
  | { type: 'manualCrash'; cause: string | null }
  | { type: 'state'; requestId: number; state: TrainingState | null }
  | { type: 'error'; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates messages arriving at the worker. Returns null for anything malformed. */
export function parseRequest(data: unknown): WorkerRequest | null {
  if (!isObj(data) || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'init':
      return (data.mode === 'train' || data.mode === 'test' || data.mode === 'manual') && isObj(data.config)
        ? (data as WorkerRequest)
        : null;
    case 'control':
      return ['play', 'pause', 'step', 'nextGeneration'].includes(data.action as string)
        ? (data as WorkerRequest)
        : null;
    case 'speed':
      return SPEEDS.includes(data.value as SimSpeed) ? (data as WorkerRequest) : null;
    case 'input':
      return isNum(data.throttle) && isNum(data.brake) && isNum(data.steer) ? (data as WorkerRequest) : null;
    case 'focus':
      return Number.isInteger(data.index) ? (data as WorkerRequest) : null;
    case 'requestState':
      return Number.isInteger(data.requestId) ? (data as WorkerRequest) : null;
    default:
      return null;
  }
}

const RESPONSE_TYPES = new Set([
  'ready',
  'frame',
  'generation',
  'testComplete',
  'manualCrash',
  'state',
  'error',
]);

/** Light structural check on worker output (the worker is our own code, but a crash can surface odd data). */
export function isResponse(data: unknown): data is WorkerResponse {
  return isObj(data) && RESPONSE_TYPES.has(data.type as string);
}
