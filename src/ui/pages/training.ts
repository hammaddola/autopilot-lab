import {
  BrainCircuit,
  Dna,
  FolderOpen,
  History,
  Play,
  RotateCcw,
  Save,
  Scale,
  SkipForward,
  Square,
  Trash2,
  UserPlus,
} from 'lucide';
import { controller } from '../../app/controller';
import type { Page } from '../../app/router';
import { genomeLength } from '../../ai/network';
import { networkLayers, type SimConfig } from '../../simulation/config';
import * as db from '../../storage/db';
import type { CheckpointRecord } from '../../storage/validation';
import { button, setButton } from '../components/button';
import { confirmAction, openDialog, promptDetails, toast } from '../components/feedback';
import { slider, textField, toggle } from '../components/form';
import { emptyState, pageHeader, panel } from '../components/layout';
import { liveStatus, populationStats, transport } from '../components/live';
import { viewport } from '../components/viewport';
import { fmt, h, setText } from '../dom';
import { NetworkView, OUTPUT_LABELS } from '../render/networkView';

const page: Page = (root) => {
  const cleanups: (() => void)[] = [];
  const status = liveStatus();
  cleanups.push(status.destroy);

  const cfg = () => controller.config;
  const edit = (fn: (c: SimConfig) => void) => {
    const c = structuredClone(controller.config);
    fn(c);
    controller.setConfig(c);
    pendingNote.hidden = !(controller.hasSession && controller.mode === 'train');
    archInfo();
  };
  const pendingNote = h(
    'p',
    { class: 'notice', hidden: true },
    'Configuration changes apply to the next run (Start or Reset).',
  );

  // ---------- Training controls ----------
  const nameField = textField('Experiment name', '', {
    maxLength: 80,
    placeholder: 'e.g. Highway, 120 cars, μ=0.1',
  });
  nameField.classList.add('grow');
  const isTraining = () => controller.hasSession && controller.mode === 'train';

  const startFresh = async () => {
    if (
      isTraining() &&
      !(await confirmAction(
        'Start a new experiment?',
        'The current run will be checkpointed and stopped, and a new population starts at generation 0.',
        { confirmLabel: 'Start new' },
      ))
    )
      return;
    await controller.start('train', { experimentName: nameField.input.value.trim() || undefined });
    pendingNote.hidden = true;
  };
  const startBtn = button({
    label: 'Start',
    icon: Play,
    variant: 'primary',
    testId: 'train-start',
    onClick: () => void startFresh(),
  });
  const stopBtn = button({
    label: 'Stop',
    icon: Square,
    testId: 'train-stop',
    onClick: () =>
      void controller.stop().then(() => toast('Training stopped. A checkpoint was saved.', 'success')),
  });
  const nextBtn = button({
    label: 'Next generation',
    icon: SkipForward,
    testId: 'train-next',
    onClick: () => controller.nextGeneration(),
  });
  const resetBtn = button({
    label: 'Reset',
    icon: RotateCcw,
    variant: 'ghost',
    testId: 'train-reset',
    onClick: async () => {
      if (
        !(await confirmAction(
          'Reset training?',
          'A new population is created at generation 0 as a new experiment. The current run is checkpointed first and stays in Analytics.',
          { confirmLabel: 'Reset', danger: true },
        ))
      )
        return;
      await controller.start('train', { experimentName: nameField.input.value.trim() || undefined });
      pendingNote.hidden = true;
    },
  });
  const saveCpBtn = button({
    label: 'Save checkpoint',
    icon: Save,
    variant: 'ghost',
    testId: 'train-save-cp',
    onClick: () => void controller.saveCheckpoint('manual').then(loadCheckpoints),
  });
  const loadCpBtn = button({
    label: 'Load checkpoint',
    icon: FolderOpen,
    variant: 'ghost',
    testId: 'train-load-cp',
    onClick: () => void chooseCheckpoint(),
  });
  const saveDriverBtn = button({
    label: 'Save best driver',
    icon: UserPlus,
    variant: 'ghost',
    testId: 'train-save-driver',
    onClick: async () => {
      const gen = controller.frame?.stats.generation ?? 0;
      const d = await promptDetails(
        'Save best driver',
        `${controller.experiment?.name ?? 'Driver'} · gen ${gen}`,
        '',
      );
      if (d) await controller.saveBestDriver(d.name, d.description);
    },
  });

  // Pause/resume and speed live on the viewport transport; this bar holds run lifecycle and persistence.
  const controlsBar = h(
    'div',
    { class: 'toolbar toolbar-split' },
    h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Run' }, startBtn, stopBtn, nextBtn, resetBtn),
    h(
      'div',
      { class: 'toolbar', role: 'group', 'aria-label': 'Save and load' },
      saveCpBtn,
      loadCpBtn,
      saveDriverBtn,
    ),
  );

  // ---------- Progress ----------
  const genBar = h('div', { class: 'bar-fill' });
  const aliveBar = h('div', { class: 'bar-fill bar-fill-2' });
  const genLabel = h('span', { class: 'small muted' });
  const aliveLabel = h('span', { class: 'small muted' });
  const progress = h(
    'div',
    { class: 'progress-grid' },
    h(
      'div',
      null,
      h('div', { class: 'bar-head' }, h('span', { class: 'small' }, 'Generation time'), genLabel),
      h('div', { class: 'bar', role: 'presentation' }, genBar),
    ),
    h(
      'div',
      null,
      h('div', { class: 'bar-head' }, h('span', { class: 'small' }, 'Population alive'), aliveLabel),
      h('div', { class: 'bar', role: 'presentation' }, aliveBar),
    ),
  );

  const vp = viewport({ height: '420px', compact: true });
  const tr = transport();
  cleanups.push(vp.destroy, tr.destroy);
  const resumeSlot = h('div');
  const simPanel = panel('Live training view', { icon: Play, actions: [tr.el] }, resumeSlot, vp.el, progress);

  // ---------- Network ----------
  const net = new NetworkView(280);
  cleanups.push(() => net.destroy());
  const outputs = h(
    'div',
    { class: 'outputs' },
    ...OUTPUT_LABELS.map((l) =>
      h(
        'div',
        { class: 'output' },
        h('span', { class: 'small muted' }, l),
        h('div', { class: 'bar bar-sm' }, h('div', { class: 'bar-fill' })),
        h('span', { class: 'mono small' }, '—'),
      ),
    ),
  );
  const archText = h('span', { class: 'panel-sub' });
  const netPanel = panel(
    'Neural network',
    { icon: BrainCircuit, subtitle: 'best car currently alive' },
    net.el,
    outputs,
    h(
      'p',
      { class: 'field-hint' },
      'Green = positive weight, red = negative; thickness ∝ |w|. Node fill shows activation. Hover for values.',
    ),
  );
  netPanel.querySelector('.panel-title')!.append(archText);
  let lastNet = 0;
  const updateNet = () => {
    const now = performance.now();
    if (now - lastNet < 100) return;
    lastNet = now;
    const f = controller.frame;
    net.set(controller.mode === 'manual' ? null : controller.focusBrain, f?.focus?.activations ?? null);
    const out = f?.focus?.activations?.at(-1);
    [...outputs.children].forEach((row, i) => {
      const v = out?.[i];
      (row.querySelector('.bar-fill') as HTMLElement).style.width = `${(v ?? 0) * 100}%`;
      row.classList.toggle('on', (v ?? 0) > 0.5);
      setText(row.querySelector('.mono')!, v === undefined ? '—' : v.toFixed(2));
    });
    const s = f?.stats;
    if (s && s.mode === 'train' && controller.activeConfig) {
      const max = controller.activeConfig.genetic.maxGenerationSeconds;
      genBar.style.width = `${Math.min(100, (s.simTime / max) * 100)}%`;
      setText(genLabel, `${s.simTime.toFixed(0)} / ${max} s`);
      aliveBar.style.width = `${(s.alive / Math.max(1, s.total)) * 100}%`;
      setText(aliveLabel, `${s.alive} / ${s.total}`);
    }
  };
  cleanups.push(controller.on('frame', updateNet));

  // ---------- Population ----------
  const stats = populationStats();
  cleanups.push(stats.destroy);
  const popPanel = panel('Population statistics', { icon: Dna, subtitle: 'current generation' }, stats.el);

  // ---------- Genetic config ----------
  const g = cfg().genetic;
  const gaPanel = panel(
    'Genetic algorithm',
    { icon: Dna },
    slider({
      label: 'Population',
      min: 10,
      max: 400,
      step: 10,
      value: g.populationSize,
      onInput: (v) => edit((c) => (c.genetic.populationSize = v)),
      testId: 'ga-population',
    }),
    slider({
      label: 'Mutation rate',
      min: 0,
      max: 0.5,
      step: 0.01,
      value: g.mutationRate,
      format: (v) => v.toFixed(2),
      hint: 'Probability that each weight mutates.',
      onInput: (v) => edit((c) => (c.genetic.mutationRate = v)),
      testId: 'ga-mutation',
    }),
    slider({
      label: 'Mutation strength',
      min: 0.05,
      max: 1.5,
      step: 0.05,
      value: g.mutationStrength,
      format: (v) => `σ ${v.toFixed(2)}`,
      onInput: (v) => edit((c) => (c.genetic.mutationStrength = v)),
    }),
    toggle(
      'Adaptive mutation',
      g.adaptiveMutation,
      (v) => edit((c) => (c.genetic.adaptiveMutation = v)),
      'Raise mutation when diversity collapses or progress stalls',
    ),
    slider({
      label: 'Elitism',
      min: 0,
      max: 0.3,
      step: 0.01,
      value: g.eliteFraction,
      format: fmt.pct,
      hint: 'Top fraction copied unchanged. The best-ever driver is always kept.',
      onInput: (v) => edit((c) => (c.genetic.eliteFraction = v)),
    }),
    slider({
      label: 'Tournament size',
      min: 2,
      max: 16,
      step: 1,
      value: g.tournamentSize,
      onInput: (v) => edit((c) => (c.genetic.tournamentSize = v)),
    }),
    slider({
      label: 'Crossover rate',
      min: 0,
      max: 1,
      step: 0.05,
      value: g.crossoverRate,
      format: fmt.pct,
      onInput: (v) => edit((c) => (c.genetic.crossoverRate = v)),
    }),
    slider({
      label: 'Generation time limit',
      min: 10,
      max: 300,
      step: 5,
      value: g.maxGenerationSeconds,
      format: (v) => `${v} s`,
      onInput: (v) => edit((c) => (c.genetic.maxGenerationSeconds = v)),
    }),
    slider({
      label: 'Stall elimination',
      min: 1,
      max: 20,
      step: 0.5,
      value: g.stallSeconds,
      format: (v) => `${v} s`,
      hint: 'Cars that make no forward progress for this long are eliminated.',
      onInput: (v) => edit((c) => (c.genetic.stallSeconds = v)),
    }),
    slider({
      label: 'Auto checkpoint every',
      min: 0,
      max: 50,
      step: 1,
      value: g.autoCheckpointEvery,
      format: (v) => (v ? `${v} gen` : 'off'),
      onInput: (v) => edit((c) => (c.genetic.autoCheckpointEvery = v)),
    }),
    h(
      'div',
      { class: 'seed-row' },
      numberSeed(g.seed, (v) => edit((c) => (c.genetic.seed = v))),
    ),
  );

  // ---------- Architecture ----------
  const archBody = h('div', { class: 'stack' });
  const archInfo = () => {
    const layers = networkLayers(cfg());
    setText(archText, ` · ${layers.join(' → ')} · ${genomeLength(layers)} parameters`);
  };
  const buildArch = () => {
    const hidden = cfg().hiddenLayers;
    archBody.replaceChildren(
      slider({
        label: 'Hidden layers',
        min: 1,
        max: 3,
        step: 1,
        value: hidden.length,
        onInput: (v) => {
          edit((c) => (c.hiddenLayers = Array.from({ length: v }, (_, i) => c.hiddenLayers[i] ?? 8)));
          buildArch();
        },
      }),
      ...hidden.map((n, i) =>
        slider({
          label: `Layer ${i + 1} neurons`,
          min: 1,
          max: 32,
          step: 1,
          value: n,
          onInput: (v) => edit((c) => (c.hiddenLayers[i] = v)),
        }),
      ),
      h(
        'p',
        { class: 'field-hint' },
        `Inputs = ${cfg().sensors.rayCount} sensor rays + speed (change rays in Simulation Studio). Outputs: throttle, left, right, brake. Hidden activation tanh, output sigmoid.`,
      ),
    );
  };
  buildArch();
  archInfo();
  const archPanel = panel('Network architecture', { icon: BrainCircuit }, archBody);

  // ---------- Fitness ----------
  const fw = cfg().fitness;
  const w = (label: string, key: keyof SimConfig['fitness'], max: number, hint: string) =>
    slider({
      label,
      min: 0,
      max,
      step: 0.5,
      value: fw[key],
      hint,
      onInput: (v) => edit((c) => (c.fitness[key] = v)),
    });
  const fitPanel = panel(
    'Fitness function',
    { icon: Scale },
    h('p', { class: 'formula mono' }, 'F = w_d·D/100 + w_c·C + w_s·S̄·[safe] + w_t·T − w_col·[crash] − w_l·L'),
    w('Distance (w_d)', 'distance', 10, 'Per 10 m of forward progress.'),
    w('Checkpoints (w_c)', 'checkpoints', 20, 'Per 50 m checkpoint passed.'),
    w('Average speed (w_s)', 'speed', 20, 'Only for drivers that did not crash.'),
    w('Time efficiency (w_t)', 'time', 20, 'Fraction of the generation spent making progress.'),
    w('Collision penalty (w_col)', 'collision', 100, 'Subtracted once for a crash.'),
    w('Lane discipline (w_l)', 'lane', 20, 'Penalty for average distance from lane centres.'),
  );

  // ---------- Checkpoints ----------
  const cpList = h('div', { class: 'list', 'data-testid': 'checkpoint-list' });
  const cpPanel = panel('Checkpoints', { icon: History, subtitle: 'restore previous sessions' }, cpList);
  let checkpoints: CheckpointRecord[] = [];
  const loadCheckpoint = async (c: CheckpointRecord) => {
    if (
      isTraining() &&
      !(await confirmAction(
        'Load checkpoint?',
        `The current run is checkpointed and replaced by "${c.experimentName}" at generation ${c.generation}.`,
        { confirmLabel: 'Load' },
      ))
    )
      return;
    await controller.start('train', { checkpoint: c });
    toast(`Resumed "${c.experimentName}" from generation ${c.generation}.`, 'success');
  };
  async function loadCheckpoints(): Promise<void> {
    try {
      const res = await db.getAll('checkpoints');
      checkpoints = res.items.sort((a, b) => b.createdAt - a.createdAt);
      if (res.corrupt.length)
        toast(
          `${res.corrupt.length} damaged checkpoint(s) were skipped. You can remove them in Settings → Data.`,
          'warning',
        );
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    if (!checkpoints.length) {
      cpList.replaceChildren(
        emptyState(
          History,
          'No checkpoints yet',
          'Checkpoints are saved automatically during training, or with “Save checkpoint”.',
        ),
      );
    } else {
      cpList.replaceChildren(
        ...checkpoints.slice(0, 12).map((c) =>
          h(
            'div',
            { class: 'list-item' },
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 'list-title' }, c.experimentName),
              h(
                'div',
                { class: 'small muted' },
                `Gen ${c.generation} · ${c.kind} · ${fmt.date(c.createdAt)} · pop ${c.state.genomes.length}`,
              ),
            ),
            button({ label: 'Load', size: 'sm', onClick: () => void loadCheckpoint(c) }),
            button({
              label: 'Delete checkpoint',
              icon: Trash2,
              iconOnly: true,
              size: 'sm',
              variant: 'ghost',
              onClick: async () => {
                if (
                  !(await confirmAction(
                    'Delete checkpoint?',
                    `Generation ${c.generation} of "${c.experimentName}" will be permanently deleted.`,
                    { confirmLabel: 'Delete', danger: true },
                  ))
                )
                  return;
                await db.remove('checkpoints', c.id).catch((e: Error) => toast(e.message, 'error'));
                void loadCheckpoints();
              },
            }),
          ),
        ),
      );
    }
    renderResume();
  }
  const chooseCheckpoint = async () => {
    await loadCheckpoints();
    if (!checkpoints.length) return toast('No checkpoints saved yet.', 'info');
    const list = h('div', { class: 'list' });
    const chosen = await new Promise<CheckpointRecord | null>((resolve) => {
      let pick: CheckpointRecord | null = null;
      for (const c of checkpoints)
        list.append(
          h(
            'label',
            { class: 'list-item check-item' },
            h('input', { type: 'radio', name: 'cp', onchange: () => (pick = c) }),
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 'list-title' }, c.experimentName),
              h(
                'div',
                { class: 'small muted' },
                `Gen ${c.generation} · ${c.kind} · ${fmt.date(c.createdAt)}`,
              ),
            ),
          ),
        );
      void openDialog(
        'Load checkpoint',
        list,
        [
          { label: 'Cancel', value: false, variant: 'ghost' },
          { label: 'Load', value: true, variant: 'primary' },
        ],
        false,
      ).then((ok) => resolve(ok ? pick : null));
    });
    if (chosen) await loadCheckpoint(chosen);
  };
  const renderResume = () => {
    const latest = checkpoints[0];
    if (isTraining() || !latest) return resumeSlot.replaceChildren();
    resumeSlot.replaceChildren(
      h(
        'div',
        { class: 'notice notice-row' },
        h('span', null, `Resume “${latest.experimentName}” from generation ${latest.generation}?`),
        button({
          label: 'Resume',
          icon: Play,
          size: 'sm',
          variant: 'primary',
          testId: 'resume-latest',
          onClick: () => void loadCheckpoint(latest),
        }),
      ),
    );
  };

  const header = pageHeader(
    'AI Training Lab',
    'Evolve neural-network drivers with a genetic algorithm. Training runs in a Web Worker.',
    status.el,
  );
  root.append(
    header,
    h(
      'div',
      { class: 'panel toolbar-panel' },
      h('div', { class: 'toolbar-row' }, nameField),
      controlsBar,
      pendingNote,
    ),
    h('div', { class: 'grid lab-grid' }, simPanel, h('div', { class: 'stack' }, netPanel, popPanel)),
    h('div', { class: 'grid grid-3' }, gaPanel, h('div', { class: 'stack' }, archPanel, cpPanel), fitPanel),
  );

  const sync = () => {
    const t = isTraining();
    stopBtn.disabled = !t;
    nextBtn.disabled = !t;
    saveCpBtn.disabled = !t;
    saveDriverBtn.disabled = !t;
    setButton(startBtn, t ? 'New run' : 'Start', Play);
    renderResume();
  };
  cleanups.push(
    controller.on('status', sync),
    controller.on('session', sync),
    controller.on('generation', () => void loadCheckpoints()),
  );
  sync();
  updateNet();
  void loadCheckpoints();
  return () => cleanups.forEach((f) => f());
};

function numberSeed(value: number, onChange: (v: number) => void): HTMLElement {
  const input = h('input', {
    type: 'number',
    class: 'input',
    min: '0',
    max: String(2 ** 31 - 1),
    value: String(value),
    id: 'ga-seed',
  });
  input.addEventListener('change', () => {
    const v = Math.max(0, Math.min(2 ** 31 - 1, Math.round(Number(input.value) || 0)));
    input.value = String(v);
    onChange(v);
  });
  return h(
    'div',
    { class: 'field grow' },
    h('label', { class: 'field-label', for: 'ga-seed' }, 'Experiment seed (initial weights & selection)'),
    input,
  );
}

export default page;
