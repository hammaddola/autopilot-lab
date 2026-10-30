import { ChartLine, Download, FlaskConical, GitCompare, Trash2, Trophy } from 'lucide';
import { controller } from '../../app/controller';
import type { Page } from '../../app/router';
import type { GenerationStats } from '../../engine/session';
import { networkLayers, PRESETS } from '../../simulation/config';
import * as db from '../../storage/db';
import type { BenchmarkRecord, ExperimentRecord } from '../../storage/validation';
import { button } from '../components/button';
import { lineChart, type ChartHandle } from '../components/chart';
import { confirmAction, toast } from '../components/feedback';
import { select } from '../components/form';
import { emptyState, pageHeader, panel, stat, table } from '../components/layout';
import { download, fmt, h, slug } from '../dom';

const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];

export function historyToCsv(history: GenerationStats[]): string {
  const cols: (keyof GenerationStats)[] = [
    'generation',
    'bestFitness',
    'avgFitness',
    'bestDistance',
    'avgDistance',
    'avgSpeed',
    'survivalRate',
    'collisions',
    'stalled',
    'finished',
    'diversity',
    'mutationRate',
    'simSeconds',
    'wallMs',
    'timestamp',
  ];
  return [cols.join(','), ...history.map((s) => cols.map((c) => s[c]).join(','))].join('\n');
}

const page: Page = (root) => {
  const charts: ChartHandle[] = [];
  const mk = (o: Parameters<typeof lineChart>[0]) => {
    const c = lineChart(o);
    charts.push(c);
    return c;
  };
  let experiments: ExperimentRecord[] = [];
  let benchmarks: BenchmarkRecord[] = [];
  let currentId = '';

  // ---------- Experiment selector & summary ----------
  const selSlot = h('div', { class: 'grow' });
  const exportJson = button({
    label: 'Export JSON',
    icon: Download,
    size: 'sm',
    onClick: () => exportExp('json'),
  });
  const exportCsv = button({
    label: 'Export CSV',
    icon: Download,
    size: 'sm',
    onClick: () => exportExp('csv'),
  });
  const delBtn = button({
    label: 'Delete experiment',
    icon: Trash2,
    iconOnly: true,
    size: 'sm',
    variant: 'ghost',
    onClick: async () => {
      const e = selected();
      if (!e) return;
      if (controller.experiment?.id === e.id && controller.hasSession && controller.mode === 'train')
        return toast('Stop training before deleting the active experiment.', 'warning');
      if (
        !(await confirmAction(
          'Delete experiment?',
          `"${e.name}" and its ${e.history.length} generations of history will be permanently deleted. Its checkpoints are kept.`,
          { confirmLabel: 'Delete', danger: true },
        ))
      )
        return;
      await db.remove('experiments', e.id).catch((err: Error) => toast(err.message, 'error'));
      currentId = '';
      await load();
    },
  });
  const summary = {
    gens: stat('Generations'),
    bestF: stat('Best fitness'),
    bestD: stat('Best distance'),
    first: stat('Gen 0 → latest avg fitness'),
    survival: stat('Latest survival'),
    duration: stat('Simulated time'),
  };
  const configLine = h('p', { class: 'small muted' });
  const head = panel(
    'Experiment',
    { icon: FlaskConical, actions: [exportJson, exportCsv, delBtn] },
    h('div', { class: 'toolbar-row' }, selSlot),
    configLine,
    h('div', { class: 'stat-grid stat-grid-6' }, ...Object.values(summary)),
  );

  const selected = () => experiments.find((e) => e.id === currentId) ?? null;
  const exportExp = (kind: 'json' | 'csv') => {
    const e = selected();
    if (!e) return;
    if (kind === 'csv') download(`${slug(e.name)}.csv`, historyToCsv(e.history), 'text/csv');
    else
      download(
        `${slug(e.name)}.json`,
        JSON.stringify({ format: 'autopilot-lab/experiment', schemaVersion: 1, experiment: e }, null, 2),
      );
  };

  // ---------- Charts ----------
  const fitness = mk({
    xLabel: 'Generation',
    yLabel: 'Fitness',
    empty: 'No generations recorded yet.',
    testId: 'chart-fitness',
  });
  const avgFit = mk({
    xLabel: 'Generation',
    yLabel: 'Average fitness',
    empty: 'No generations recorded yet.',
  });
  const distance = mk({
    xLabel: 'Generation',
    yLabel: 'Best distance (m)',
    empty: 'No generations recorded yet.',
  });
  const diversity = mk({
    xLabel: 'Generation',
    yLabel: 'Diversity (mean gene σ)',
    empty: 'No generations recorded yet.',
    yFormat: (v) => v.toFixed(3),
  });
  const survival = mk({
    xLabel: 'Generation',
    yLabel: 'Survival rate',
    empty: 'No generations recorded yet.',
    yFormat: (v) => `${Math.round(v * 100)}%`,
  });
  const collisions = mk({ xLabel: 'Generation', yLabel: 'Cars', empty: 'No generations recorded yet.' });
  const chartGrid = h(
    'div',
    { class: 'grid grid-2' },
    panel('Best fitness per generation', { icon: ChartLine }, fitness.el),
    panel('Average fitness per generation', { icon: ChartLine }, avgFit.el),
    panel('Best distance per generation', { icon: ChartLine }, distance.el),
    panel('Population diversity', { icon: ChartLine }, diversity.el),
    panel('Survival rate', { icon: ChartLine }, survival.el),
    panel('Collisions & eliminations', { icon: ChartLine }, collisions.el),
  );

  const renderExperiment = () => {
    const e = selected();
    const hist = e?.history ?? [];
    const gens = hist.map((s) => s.generation);
    fitness.update(gens, [
      { label: 'Best fitness', data: hist.map((s) => s.bestFitness), color: '--series-1' },
      { label: 'Average fitness', data: hist.map((s) => s.avgFitness), color: '--series-2', dashed: true },
    ]);
    avgFit.update(gens, [
      { label: 'Average fitness', data: hist.map((s) => s.avgFitness), color: '--series-2' },
    ]);
    distance.update(gens, [
      { label: 'Best distance', data: hist.map((s) => s.bestDistance / 10), color: '--series-1' },
      {
        label: 'Average distance',
        data: hist.map((s) => s.avgDistance / 10),
        color: '--series-3',
        dashed: true,
      },
    ]);
    diversity.update(gens, [
      { label: 'Diversity', data: hist.map((s) => s.diversity), color: '--series-4' },
      { label: 'Mutation rate', data: hist.map((s) => s.mutationRate), color: '--series-5', dashed: true },
    ]);
    survival.update(gens, [
      { label: 'Survival rate', data: hist.map((s) => s.survivalRate), color: '--series-3' },
    ]);
    collisions.update(gens, [
      { label: 'Collisions', data: hist.map((s) => s.collisions), color: '--series-6', type: 'bar' },
      { label: 'Stalled', data: hist.map((s) => s.stalled), color: '--series-5', type: 'bar' },
    ]);
    const first = hist[0],
      last = hist.at(-1);
    summary.gens.set(fmt.int(hist.length));
    summary.bestF.set(e ? fmt.num(Math.max(...hist.map((s) => s.bestFitness), 0)) : '—');
    summary.bestD.set(e ? fmt.dist(Math.max(...hist.map((s) => s.bestDistance), 0)) : '—');
    summary.first.set(first && last ? `${fmt.num(first.avgFitness)} → ${fmt.num(last.avgFitness)}` : '—');
    summary.survival.set(last ? fmt.pct(last.survivalRate) : '—');
    summary.duration.set(e ? fmt.duration(hist.reduce((a, s) => a + s.simSeconds, 0)) : '—');
    configLine.textContent = e
      ? `${PRESETS[e.config.env.preset].label} · scenario seed ${e.config.env.seed} · population ${e.config.genetic.populationSize} · μ ${e.config.genetic.mutationRate} · network ${networkLayers(e.config).join('-')} · GA seed ${e.config.genetic.seed}`
      : '';
    [exportJson, exportCsv, delBtn].forEach((b) => (b.disabled = !e));
  };

  // ---------- Comparison ----------
  const compareList = h('div', { class: 'check-list' });
  const compareChart = mk({
    xLabel: 'Generation',
    yLabel: 'Best fitness',
    empty: 'Select two or more experiments to compare.',
    height: 260,
    testId: 'chart-compare',
  });
  const compareTable = h('div');
  const comparing = new Set<string>();
  const comparePanel = panel(
    'Compare experiments',
    { icon: GitCompare, subtitle: 'training configurations side by side' },
    compareList,
    compareChart.el,
    compareTable,
  );
  const renderCompare = () => {
    const chosen = experiments.filter((e) => comparing.has(e.id));
    const maxGen = Math.max(0, ...chosen.map((e) => e.history.length));
    const labels = Array.from({ length: maxGen }, (_, i) => i);
    compareChart.update(
      chosen.length >= 1 ? labels : [],
      chosen.map((e, i) => ({
        label: e.name,
        data: labels.map((g) => e.history[g]?.bestFitness ?? null),
        color: SERIES[i % SERIES.length]!,
      })),
    );
    compareTable.replaceChildren(
      chosen.length
        ? table(
            [
              'Experiment',
              'Environment',
              'Pop.',
              'μ',
              'Network',
              'Gens',
              'Best fitness',
              'Best distance',
              'Gen of best',
              'Final survival',
            ],
            chosen.map((e) => {
              const best = e.history.reduce<GenerationStats | null>(
                (b, s) => (!b || s.bestFitness > b.bestFitness ? s : b),
                null,
              );
              return [
                e.name,
                `${PRESETS[e.config.env.preset].label} #${e.config.env.seed}`,
                String(e.config.genetic.populationSize),
                String(e.config.genetic.mutationRate),
                networkLayers(e.config).join('-'),
                String(e.history.length),
                best ? fmt.num(best.bestFitness) : '—',
                best ? fmt.dist(Math.max(...e.history.map((s) => s.bestDistance))) : '—',
                best ? String(best.generation) : '—',
                e.history.at(-1) ? fmt.pct(e.history.at(-1)!.survivalRate) : '—',
              ];
            }),
          )
        : h('span'),
    );
  };

  // ---------- Benchmarks ----------
  const benchBody = h('div');
  const benchPanel = panel(
    'Benchmark results',
    { icon: Trophy, subtitle: 'driver tests on fixed scenarios' },
    benchBody,
  );
  const renderBenchmarks = () => {
    if (!benchmarks.length) {
      benchBody.replaceChildren(
        emptyState(
          Trophy,
          'No benchmark runs',
          'Run a driver test in Simulation Studio. Every completed test is recorded here.',
        ),
      );
      return;
    }
    const rows = benchmarks.flatMap((b) =>
      b.results.map((r) => [
        fmt.date(b.createdAt),
        `${PRESETS[b.scenario.preset].label} #${b.scenario.seed}`,
        r.driverName,
        r.status,
        fmt.dist(r.distance),
        `${r.time.toFixed(1)} s`,
        `${fmt.int(r.avgSpeed * 0.36)} km/h`,
        fmt.num(r.laneDeviation, 2),
        fmt.num(r.fitness),
      ]),
    );
    benchBody.replaceChildren(
      table(
        ['When', 'Scenario', 'Driver', 'Outcome', 'Distance', 'Time', 'Avg speed', 'Lane dev.', 'Fitness'],
        rows.slice(0, 100),
        'benchmark-table',
      ),
      h(
        'div',
        { class: 'toolbar' },
        button({
          label: 'Export benchmarks',
          icon: Download,
          size: 'sm',
          onClick: () =>
            download(
              'benchmarks.json',
              JSON.stringify({ format: 'autopilot-lab/benchmarks', schemaVersion: 1, benchmarks }, null, 2),
            ),
        }),
      ),
    );
  };

  root.append(
    pageHeader(
      'Analytics',
      'Recorded generation history, experiment comparison and benchmark results. Every number comes from a real simulation run.',
    ),
    head,
    chartGrid,
    h('div', { class: 'grid grid-2' }, comparePanel, benchPanel),
  );

  async function load(): Promise<void> {
    try {
      const [e, b] = await Promise.all([db.getAll('experiments'), db.getAll('benchmarks')]);
      experiments = e.items.sort((a, x) => x.updatedAt - a.updatedAt);
      benchmarks = b.items.sort((a, x) => x.createdAt - a.createdAt);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    // Live experiment: use the in-memory record so charts update without waiting for the DB write.
    const live = controller.experiment;
    if (live) experiments = [live, ...experiments.filter((e) => e.id !== live.id)];
    if (!currentId || !experiments.some((e) => e.id === currentId)) currentId = experiments[0]?.id ?? '';
    if (!experiments.length) {
      selSlot.replaceChildren(
        h('p', { class: 'muted' }, 'No experiments yet. Start training in the AI Training Lab.'),
      );
    } else {
      selSlot.replaceChildren(
        select(
          'Experiment',
          experiments.map((e) => ({ value: e.id, label: `${e.name} · ${e.history.length} gen` })),
          currentId,
          (v) => {
            currentId = v;
            renderExperiment();
          },
          'experiment-select',
        ),
      );
    }
    compareList.replaceChildren(
      ...(experiments.length
        ? experiments.map((e) => {
            const cb = h('input', { type: 'checkbox', checked: comparing.has(e.id) });
            cb.addEventListener('change', () => {
              if (cb.checked) comparing.add(e.id);
              else comparing.delete(e.id);
              renderCompare();
            });
            return h(
              'label',
              { class: 'check-item' },
              cb,
              h('span', null, e.name),
              h('span', { class: 'small muted' }, `${e.history.length} gen`),
            );
          })
        : [h('p', { class: 'muted small' }, 'No experiments to compare yet.')]),
    );
    renderExperiment();
    renderCompare();
    renderBenchmarks();
  }

  const offs = [
    controller.on('generation', () => {
      if (controller.experiment?.id === currentId) renderExperiment();
      if (comparing.has(controller.experiment?.id ?? '')) renderCompare();
    }),
    controller.on('session', () => void load()),
    controller.on('results', () => void load()),
  ];
  void load();
  return () => {
    offs.forEach((f) => f());
    charts.forEach((c) => c.destroy());
  };
};

export default page;
