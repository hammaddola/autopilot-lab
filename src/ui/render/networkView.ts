import { biasIndex, weightIndex, type Brain } from '../../ai/network';
import { h } from '../dom';

export const OUTPUT_LABELS = ['Throttle', 'Left', 'Right', 'Brake'];

export function inputLabels(n: number): string[] {
  return [...Array.from({ length: n - 1 }, (_, i) => `S${i + 1}`), 'Speed'];
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

interface NodePos {
  x: number;
  y: number;
  layer: number;
  index: number;
}

/**
 * Canvas visualisation of a feed-forward network: connection colour = weight sign, opacity/width = |w|,
 * node fill = current activation. Hovering a connection or node shows its value.
 */
export class NetworkView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private tip: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private brain: Brain | null = null;
  private acts: number[][] | null = null;
  private nodes: NodePos[][] = [];
  private ro: ResizeObserver;
  private w = 0;
  private hgt = 0;
  private pending = false;

  constructor(height = 260) {
    this.canvas = h('canvas', {
      class: 'net-canvas',
      role: 'img',
      'aria-label': 'Neural network weights and activations',
    });
    this.tip = h('div', { class: 'net-tip', hidden: true });
    this.el = h(
      'div',
      { class: 'net-view', style: `height:${height}px`, 'data-testid': 'network-view' },
      this.canvas,
      this.tip,
    );
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.canvas.addEventListener('mousemove', this.onMove);
    this.canvas.addEventListener('mouseleave', () => (this.tip.hidden = true));
    window.addEventListener('themechange', this.redraw);
  }

  destroy(): void {
    this.ro.disconnect();
    window.removeEventListener('themechange', this.redraw);
  }

  set(brain: Brain | null, activations: number[][] | null): void {
    this.brain = brain;
    this.acts = activations && brain && activations.length === brain.layers.length ? activations : null;
    this.redraw();
  }

  private resize(): void {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.hgt = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  private redraw = () => {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  };

  private layout(layers: number[]): void {
    const padX = 56,
      padY = 18;
    const cols = layers.length;
    this.nodes = layers.map((n, l) => {
      const x = cols === 1 ? this.w / 2 : padX + ((this.w - padX * 2) * l) / (cols - 1);
      const gap = Math.min(30, (this.hgt - padY * 2) / Math.max(1, n - 1));
      const top = this.hgt / 2 - (gap * (n - 1)) / 2;
      return Array.from({ length: n }, (_, i) => ({
        x,
        y: n === 1 ? this.hgt / 2 : top + gap * i,
        layer: l,
        index: i,
      }));
    });
  }

  private draw(): void {
    const { ctx, w, hgt } = this;
    ctx.clearRect(0, 0, w, hgt);
    const b = this.brain;
    if (!b || w === 0) {
      ctx.fillStyle = css('--text-faint');
      ctx.font = '13px Inter Variable, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No network to display yet', w / 2, hgt / 2);
      return;
    }
    this.layout(b.layers);
    const pos = css('--weight-pos'),
      neg = css('--weight-neg'),
      text = css('--text-muted'),
      surface = css('--surface-2');
    let maxW = 0;
    for (let i = 0; i < b.genome.length; i++) maxW = Math.max(maxW, Math.abs(b.genome[i]!));
    maxW = maxW || 1;

    for (let l = 0; l < b.layers.length - 1; l++) {
      for (const o of this.nodes[l + 1]!) {
        for (const i of this.nodes[l]!) {
          const wv = b.genome[weightIndex(b.layers, l, i.index, o.index)]!;
          const m = Math.abs(wv) / maxW;
          ctx.strokeStyle = wv >= 0 ? pos : neg;
          ctx.globalAlpha = 0.08 + 0.75 * m;
          ctx.lineWidth = 0.5 + 2 * m;
          ctx.beginPath();
          ctx.moveTo(i.x, i.y);
          ctx.lineTo(o.x, o.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    const ins = inputLabels(b.layers[0]!);
    ctx.font = '11px Inter Variable, system-ui, sans-serif';
    for (const layer of this.nodes) {
      for (const n of layer) {
        const a = this.acts?.[n.layer]?.[n.index] ?? 0;
        const last = n.layer === b.layers.length - 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = surface;
        ctx.fill();
        if (this.acts) {
          // Outputs/inputs are 0..1; hidden tanh is -1..1.
          ctx.globalAlpha = Math.min(1, Math.abs(a));
          ctx.fillStyle = a >= 0 ? pos : neg;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = last && a > 0.5 ? 2.5 : 1;
        ctx.strokeStyle = last && a > 0.5 ? pos : text;
        ctx.stroke();
        ctx.fillStyle = text;
        if (n.layer === 0) {
          ctx.textAlign = 'right';
          ctx.fillText(ins[n.index]!, n.x - 13, n.y + 4);
        } else if (last) {
          ctx.textAlign = 'left';
          ctx.fillText(OUTPUT_LABELS[n.index] ?? `O${n.index + 1}`, n.x + 13, n.y + 4);
        }
      }
    }
  }

  private onMove = (e: MouseEvent) => {
    const b = this.brain;
    if (!b) return;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    let label = '';
    const ins = inputLabels(b.layers[0]!);
    const name = (n: NodePos) =>
      n.layer === 0
        ? ins[n.index]!
        : n.layer === b.layers.length - 1
          ? OUTPUT_LABELS[n.index]!
          : `H${n.layer}.${n.index + 1}`;

    outer: for (const layer of this.nodes) {
      for (const n of layer) {
        if (Math.hypot(mx - n.x, my - n.y) <= 10) {
          const a = this.acts?.[n.layer]?.[n.index];
          const bias = n.layer > 0 ? b.genome[biasIndex(b.layers, n.layer - 1, n.index)]! : null;
          label = `${name(n)}${a !== undefined ? ` · activation ${a.toFixed(3)}` : ''}${bias !== null ? ` · bias ${bias.toFixed(3)}` : ''}`;
          break outer;
        }
      }
    }
    if (!label) {
      let best = 6;
      for (let l = 0; l < b.layers.length - 1; l++)
        for (const o of this.nodes[l + 1]!)
          for (const i of this.nodes[l]!) {
            const d = distToSegment(mx, my, i.x, i.y, o.x, o.y);
            if (d < best) {
              best = d;
              label = `${name(i)} → ${name(o)} · w = ${b.genome[weightIndex(b.layers, l, i.index, o.index)]!.toFixed(3)}`;
            }
          }
    }
    this.tip.hidden = !label;
    if (label) {
      this.tip.textContent = label;
      this.tip.style.left = `${Math.min(mx + 12, this.w - 220)}px`;
      this.tip.style.top = `${my + 12}px`;
    }
  };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
