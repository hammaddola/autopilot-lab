import { BrainCircuit, ChartLine, FlaskConical, Gamepad2, LibraryBig, Play } from 'lucide';
import { controller } from '../../app/controller';
import { navigate } from '../../app/nav';
import type { Page } from '../../app/router';
import { PRESETS } from '../../simulation/config';
import * as db from '../../storage/db';
import { button } from '../components/button';
import { lineChart } from '../components/chart';
import { emptyState, pageHeader, panel, stat } from '../components/layout';
import { liveStatus, populationStats, transport } from '../components/live';
import { viewport } from '../components/viewport';
import { fmt, h } from '../dom';

const page: Page = (root) => {
  const status = liveStatus();
  const header = pageHeader(
    'Dashboard',
    'Live overview of the active simulation and your saved research.',
    status.el,
  );

  const vp = viewport({ height: '520px' });
  const tr = transport();
  const sessionInfo = h('p', { class: 'muted small' });
  const live = panel('Active simulation', { icon: Play, actions: [tr.el] }, vp.el, sessionInfo);

  const stats = populationStats();
  const statsPanel = panel(
    'Population',
    { icon: BrainCircuit, subtitle: 'live, current generation' },
    stats.el,
  );

  const chart = lineChart({
    xLabel: 'Generation',
    yLabel: 'Fitness',
    empty: 'Fitness history appears after the first generation completes.',
    height: 200,
  });
  const chartPanel = panel('Fitness by generation', { icon: ChartLine }, chart.el);

  const quick = h(
    'div',
    { class: 'quick-actions' },
    button({
      label: 'Train AI',
      icon: FlaskConical,
      variant: 'primary',
      onClick: () => navigate('training'),
      testId: 'quick-train',
    }),
    button({
      label: 'Drive manually',
      icon: Gamepad2,
      onClick: () => void controller.start('manual').then(() => navigate('studio')),
      testId: 'quick-manual',
    }),
    button({ label: 'Driver library', icon: LibraryBig, onClick: () => navigate('library') }),
  );

  const library = {
    drivers: stat('Saved drivers'),
    experiments: stat('Experiments'),
    checkpoints: stat('Checkpoints'),
    benchmarks: stat('Benchmark runs'),
  };
  const libPanel = panel(
    'Research data',
    { icon: LibraryBig, subtitle: 'stored on this device' },
    h('div', { class: 'stat-grid stat-grid-4' }, ...Object.values(library)),
  );

  const emptyLive = emptyState(
    Play,
    'No simulation running',
    'Start training a population, test a saved driver, or take the wheel yourself.',
    quick,
  );

  root.append(
    header,
    h(
      'div',
      { class: 'grid dash-grid' },
      h('div', { class: 'stack' }, live, libPanel),
      h('div', { class: 'stack' }, statsPanel, chartPanel),
    ),
  );

  const sync = () => {
    const has = controller.hasSession;
    vp.el.hidden = !has;
    tr.el.hidden = !has;
    if (!has && !live.body.contains(emptyLive)) live.body.prepend(emptyLive);
    if (has) emptyLive.remove();
    const cfg = controller.activeConfig;
    sessionInfo.textContent =
      has && cfg
        ? `${{ train: 'Training', test: 'Testing', manual: 'Manual driving' }[controller.mode]} · ${PRESETS[cfg.env.preset].label} · seed ${cfg.env.seed}${controller.experiment && controller.mode === 'train' ? ` · ${controller.experiment.name}` : ''}`
        : '';
    statsPanel.hidden = controller.mode !== 'train' || !has;
    const hist = controller.mode === 'train' ? (controller.experiment?.history ?? []) : [];
    chart.update(
      hist.map((s) => s.generation),
      [
        { label: 'Best fitness', data: hist.map((s) => s.bestFitness), color: '--series-1' },
        { label: 'Average fitness', data: hist.map((s) => s.avgFitness), color: '--series-2' },
      ],
    );
  };

  const loadCounts = async () => {
    try {
      const [d, e, c, b] = await Promise.all([
        db.getAll('drivers'),
        db.getAll('experiments'),
        db.getAll('checkpoints'),
        db.getAll('benchmarks'),
      ]);
      library.drivers.set(fmt.int(d.items.length));
      library.experiments.set(fmt.int(e.items.length));
      library.checkpoints.set(fmt.int(c.items.length));
      library.benchmarks.set(fmt.int(b.items.length));
    } catch (err) {
      library.drivers.set('—', (err as Error).message);
    }
  };

  const offs = [
    controller.on('session', sync),
    controller.on('generation', sync),
    controller.on('status', sync),
  ];
  sync();
  void loadCounts();

  return () => {
    offs.forEach((f) => f());
    [status, vp, tr, stats, chart].forEach((c) => c.destroy());
  };
};

export default page;
