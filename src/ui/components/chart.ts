import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartDataset,
} from 'chart.js';
import { h } from '../dom';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

export interface Series {
  label: string;
  data: (number | null)[];
  /** CSS custom property name for the series colour, e.g. '--series-1'. */
  color: string;
  type?: 'line' | 'bar';
  dashed?: boolean;
}

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

export interface ChartHandle {
  el: HTMLElement;
  update(labels: (string | number)[], series: Series[]): void;
  destroy(): void;
}

/**
 * Chart.js wrapper with axis titles, tooltips, an empty state and theme-aware colours.
 * Animation is disabled: charts update live and motion would only add noise.
 */
export function lineChart(o: {
  xLabel: string;
  yLabel: string;
  empty: string;
  yFormat?: (v: number) => string;
  height?: number;
  testId?: string;
}): ChartHandle {
  const canvas = h('canvas', { role: 'img', 'aria-label': `${o.yLabel} by ${o.xLabel}` });
  const empty = h('div', { class: 'chart-empty' }, o.empty);
  const el = h(
    'div',
    { class: 'chart', style: `height:${o.height ?? 220}px`, 'data-testid': o.testId },
    canvas,
    empty,
  );
  let chart: Chart | null = null;
  let last: { labels: (string | number)[]; series: Series[] } = { labels: [], series: [] };

  const build = () => {
    chart?.destroy();
    const grid = css('--chart-grid'),
      text = css('--text-muted');
    chart = new Chart(canvas, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: false,
            labels: { color: text, boxWidth: 10, boxHeight: 10, font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: css('--surface-3'),
            titleColor: css('--text'),
            bodyColor: css('--text'),
            borderColor: css('--border-strong'),
            borderWidth: 1,
            padding: 8,
            callbacks: o.yFormat
              ? { label: (c) => `${c.dataset.label}: ${o.yFormat!(Number(c.parsed.y))}` }
              : {},
          },
        },
        scales: {
          x: {
            title: { display: true, text: o.xLabel, color: text, font: { size: 11 } },
            ticks: { color: text, maxTicksLimit: 8, font: { size: 11 } },
            grid: { color: grid },
          },
          y: {
            title: { display: true, text: o.yLabel, color: text, font: { size: 11 } },
            ticks: {
              color: text,
              font: { size: 11 },
              ...(o.yFormat ? { callback: (v) => o.yFormat!(Number(v)) } : {}),
            },
            grid: { color: grid },
          },
        },
      },
    });
    apply();
  };

  const apply = () => {
    if (!chart) return;
    const { labels, series } = last;
    chart.data.labels = labels;
    chart.data.datasets = series.map((s): ChartDataset<'line'> => {
      const color = css(s.color);
      return {
        type: s.type ?? 'line',
        label: s.label,
        data: s.data,
        borderColor: color,
        backgroundColor: s.type === 'bar' ? color : `${color}22`,
        borderWidth: 2,
        borderDash: s.dashed ? [5, 4] : undefined,
        pointRadius: labels.length > 40 ? 0 : 2,
        pointHoverRadius: 4,
        tension: 0.25,
        spanGaps: true,
      } as ChartDataset<'line'>;
    });
    chart.options.plugins!.legend!.display = series.length > 1;
    chart.update('none');
    empty.hidden = labels.length > 0;
  };

  const onTheme = () => build();
  window.addEventListener('themechange', onTheme);
  // Defer creation until the element is in the DOM so Chart.js can measure it.
  requestAnimationFrame(build);

  return {
    el,
    update(labels, series) {
      last = { labels, series };
      apply();
    },
    destroy() {
      window.removeEventListener('themechange', onTheme);
      chart?.destroy();
      chart = null;
    },
  };
}
