/// <reference lib="webworker" />
import { deserializeBrain, serializeBrain, type SerializedBrain } from '../ai/network';
import { Session, type SessionEvent } from '../engine/session';
import { FIXED_DT, sanitizeConfig } from '../simulation/config';
import { validateTrainingState } from '../storage/validation';
import { parseRequest, type SimSpeed, type WorkerRequest, type WorkerResponse } from './protocol';

/**
 * Runs the simulation and training off the main thread. The loop advances the session with a fixed
 * timestep (accumulator pattern) scaled by the speed multiplier, and posts one compact frame per tick.
 * A per-tick time budget keeps the worker responsive to control messages at high speed / population.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const TICK_MS = 16;
const BUDGET_MS = 14;

let session: Session | null = null;
let running = false;
let speed: SimSpeed = 1;
let acc = 0;
let last = performance.now();
let dirty = false;
let lastFocusKey = '';
let stepCounter = 0;
let stepWindowStart = performance.now();
let stepsPerSecond = 0;
let workerMsAvg = 0;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);

function handleEvent(ev: SessionEvent | null): void {
  if (!ev || !session) return;
  if (ev.type === 'generation') {
    post({ type: 'generation', stats: ev.stats, state: ev.autoCheckpoint ? session.exportState() : null });
  } else if (ev.type === 'testComplete') {
    running = false;
    post({ type: 'testComplete', results: ev.results });
  } else if (ev.type === 'manualCrash') {
    running = false;
    post({ type: 'manualCrash', cause: ev.cause });
  }
}

function tick(): void {
  const now = performance.now();
  try {
    if (session && running) {
      // Clamp the backlog so a stalled tab does not trigger a burst of catch-up steps.
      acc = Math.min(acc + ((now - last) / 1000) * speed, speed * 0.25);
      while (acc >= FIXED_DT && running) {
        handleEvent(session.step());
        acc -= FIXED_DT;
        stepCounter++;
        if (performance.now() - now > BUDGET_MS) {
          acc = 0;
          break;
        }
      }
      dirty = true;
    }
    const spent = performance.now() - now;
    workerMsAvg = workerMsAvg * 0.9 + spent * 0.1;
    if (now - stepWindowStart >= 1000) {
      stepsPerSecond = (stepCounter * 1000) / (now - stepWindowStart);
      stepCounter = 0;
      stepWindowStart = now;
    }
    if (session && dirty) postFrame();
  } catch (err) {
    running = false;
    post({ type: 'error', message: `Simulation error: ${err instanceof Error ? err.message : String(err)}` });
  }
  last = now;
  setTimeout(tick, TICK_MS);
}

function postFrame(): void {
  if (!session) return;
  dirty = false;
  const { cars, traffic } = session.snapshot();
  const key = `${session.generation}:${session.focusIndex}`;
  let focusBrain: SerializedBrain | null = null;
  if (key !== lastFocusKey) {
    const b = session.focusBrain();
    focusBrain = b && serializeBrain(b);
    lastFocusKey = key;
  }
  post(
    {
      type: 'frame',
      cars,
      traffic,
      focus: session.focus(),
      focusBrain,
      stats: session.liveStats(),
      perf: { stepsPerSecond: running ? stepsPerSecond : 0, workerMs: workerMsAvg },
    },
    [cars.buffer, traffic.buffer],
  );
}

function handle(msg: WorkerRequest): void {
  switch (msg.type) {
    case 'init': {
      const config = sanitizeConfig(msg.config);
      const drivers = msg.drivers?.map((d) => ({
        id: String(d.id),
        name: String(d.name),
        brain: deserializeBrain(d.brain),
        sensors: sanitizeConfig({ sensors: d.sensors }).sensors,
      }));
      const state = msg.state ? validateTrainingState(msg.state, config) : undefined;
      session = new Session({ mode: msg.mode, config, drivers, state });
      running = msg.autoplay;
      acc = 0;
      lastFocusKey = '';
      dirty = true;
      post({ type: 'ready', mode: msg.mode });
      break;
    }
    case 'control':
      if (!session) return;
      if (msg.action === 'play') running = !session.isFinished;
      else if (msg.action === 'pause') running = false;
      else if (msg.action === 'step') {
        running = false;
        handleEvent(session.step());
      } else handleEvent(session.forceNextGeneration());
      dirty = true;
      break;
    case 'speed':
      speed = msg.value;
      break;
    case 'input':
      if (session)
        Object.assign(session.manual, { throttle: msg.throttle, brake: msg.brake, steer: msg.steer });
      break;
    case 'focus':
      if (session) session.pinnedFocus = msg.index;
      dirty = true;
      break;
    case 'requestState':
      post({
        type: 'state',
        requestId: msg.requestId,
        state: session?.mode === 'train' ? session.exportState() : null,
      });
      break;
  }
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = parseRequest(e.data);
  if (!msg) {
    post({ type: 'error', message: 'Ignored malformed message.' });
    return;
  }
  try {
    handle(msg);
  } catch (err) {
    running = false;
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

tick();
