import { Pause, Play, RotateCcw, StepForward } from 'lucide';
import { controller } from '../../app/controller';
import { UNIT_TO_KMH } from '../../simulation/config';
import { SPEEDS, type SimSpeed } from '../../workers/protocol';
import { fmt, h } from '../dom';
import { button, segmented, setButton } from './button';
import { confirmAction, statusPill, type StatusTone } from './feedback';
import { stat } from './layout';

const TONE: Record<string, StatusTone> = {
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  finished: 'done',
  crashed: 'error',
  error: 'error',
};
const LABEL: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  finished: 'Finished',
  crashed: 'Crashed',
  error: 'Error',
};

/** Live status pill bound to the controller. */
export function liveStatus(): { el: HTMLElement; destroy(): void } {
  const pill = statusPill('Idle', 'idle');
  pill.dataset.testid = 'run-status';
  const sync = () =>
    pill.set(LABEL[controller.status] ?? controller.status, TONE[controller.status] ?? 'idle');
  const off = controller.on('status', sync);
  const off2 = controller.on('session', sync);
  sync();
  return { el: pill, destroy: () => (off(), off2()) };
}

/** Play/pause, step, restart and speed controls. */
export function transport(): { el: HTMLElement; destroy(): void } {
  const playBtn = button({
    label: 'Pause',
    icon: Pause,
    variant: 'primary',
    testId: 'play-pause',
    onClick: () => (controller.status === 'running' ? controller.pause() : controller.play()),
  });
  const stepBtn = button({
    label: 'Step forward',
    icon: StepForward,
    iconOnly: true,
    testId: 'step',
    onClick: () => controller.step(),
  });
  const restartBtn = button({
    label: 'Restart',
    icon: RotateCcw,
    iconOnly: true,
    testId: 'restart',
    onClick: async () => {
      if (
        controller.mode === 'train' &&
        !(await confirmAction(
          'Restart training?',
          'This starts a new experiment from generation 0. The current run is checkpointed first and stays available in Analytics.',
          { confirmLabel: 'Restart' },
        ))
      )
        return;
      await controller.restart();
    },
  });
  const speed = segmented(
    SPEEDS.map((s) => ({ value: s, label: `${s}×` })),
    controller.speed,
    (v: SimSpeed) => controller.setSpeed(v),
    'Simulation speed',
  );
  speed.dataset.testid = 'speed';
  const sync = () => {
    const has = controller.hasSession;
    const running = controller.status === 'running';
    setButton(playBtn, running ? 'Pause' : 'Resume', running ? Pause : Play);
    playBtn.disabled =
      !has ||
      controller.status === 'finished' ||
      controller.status === 'crashed' ||
      controller.status === 'error';
    stepBtn.disabled = !has || controller.status === 'finished' || controller.status === 'crashed';
    restartBtn.disabled = !has && controller.status !== 'error';
    speed.set(controller.speed);
  };
  const offs = [controller.on('status', sync), controller.on('session', sync)];
  sync();
  return {
    el: h('div', { class: 'transport' }, playBtn, stepBtn, restartBtn, speed),
    destroy: () => offs.forEach((f) => f()),
  };
}

/** Grid of live population metrics. Values come straight from the worker frame — nothing is estimated. */
export function populationStats(): { el: HTMLElement; destroy(): void } {
  const tiles = {
    generation: stat('Generation', '—', 'stat-generation'),
    alive: stat('Cars alive', '—', 'stat-alive'),
    eliminated: stat('Eliminated'),
    bestDistance: stat('Best distance'),
    avgDistance: stat('Avg distance'),
    bestFitness: stat('Best fitness'),
    avgFitness: stat('Avg fitness'),
    avgSpeed: stat('Avg speed'),
    collisions: stat('Collisions'),
    survival: stat('Survival rate'),
    duration: stat('Training time'),
    mutation: stat('Mutation rate'),
    diversity: stat('Diversity'),
  };
  const el = h('div', { class: 'stat-grid' }, ...Object.values(tiles));
  let last = 0;
  const update = () => {
    const now = performance.now();
    if (now - last < 250) return;
    last = now;
    const f = controller.frame;
    if (!f || f.stats.mode !== 'train') {
      for (const t of Object.values(tiles)) t.set('—');
      return;
    }
    const s = f.stats;
    tiles.generation.set(String(s.generation), `${fmt.num(s.simTime, 0)} s into generation`);
    tiles.alive.set(fmt.int(s.alive), `of ${s.total}`);
    tiles.eliminated.set(fmt.int(s.eliminated));
    tiles.bestDistance.set(fmt.dist(s.bestDistance));
    tiles.avgDistance.set(fmt.dist(s.avgDistance));
    tiles.bestFitness.set(fmt.num(s.bestFitness), `best ever ${fmt.num(s.bestEverFitness)}`);
    tiles.avgFitness.set(fmt.num(s.avgFitness));
    tiles.avgSpeed.set(`${fmt.int(s.avgSpeed * UNIT_TO_KMH)} km/h`, 'cars alive');
    tiles.collisions.set(fmt.int(s.collisions), 'this generation');
    tiles.survival.set(fmt.pct(s.survivalRate));
    tiles.duration.set(
      fmt.duration((Date.now() - controller.trainingStartedAt) / 1000),
      `${fmt.duration(s.trainingSimSeconds)} simulated`,
    );
    tiles.mutation.set(
      fmt.num(s.mutationRate, 3),
      controller.activeConfig?.genetic.adaptiveMutation ? 'adaptive' : 'fixed',
    );
    tiles.diversity.set(fmt.num(s.diversity, 3), 'mean gene σ');
  };
  const offs = [controller.on('frame', update), controller.on('session', () => ((last = 0), update()))];
  update();
  return { el, destroy: () => offs.forEach((f) => f()) };
}
