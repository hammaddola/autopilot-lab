import { controller, type FrameMessage } from '../../app/controller';
import type { ResolvedQuality } from '../../app/preferences';
import { CAR_LENGTH, CAR_WIDTH } from '../../simulation/car';
import { CHECKPOINT_SPACING, type EnvironmentConfig } from '../../simulation/config';
import { Road, ROAD_STEP, type RoadLocation } from '../../simulation/road';
import { rayOffset } from '../../simulation/sensor';

interface Palette {
  ground: string;
  groundAlt: string;
  road: string;
  lane: string;
  edge: string;
  marker: string;
  text: string;
  accent: string;
  accent2: string;
  danger: string;
  warn: string;
  traffic: string[];
  truck: string;
  obstacle: string;
  ghost: string;
  dead: string;
  tree: string;
  building: string;
}

const QUALITY: Record<ResolvedQuality, { dpr: number; ghosts: number; scenery: boolean; shadows: boolean }> =
  {
    low: { dpr: 1, ghosts: 30, scenery: false, shadows: false },
    balanced: { dpr: 1.5, ghosts: 120, scenery: true, shadows: false },
    high: { dpr: 2, ghosts: 400, scenery: true, shadows: true },
  };

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function readPalette(): Palette {
  return {
    ground: css('--sim-ground'),
    groundAlt: css('--sim-ground-alt'),
    road: css('--sim-road'),
    lane: css('--sim-lane'),
    edge: css('--sim-edge'),
    marker: css('--sim-marker'),
    text: css('--text-muted'),
    accent: css('--accent'),
    accent2: css('--accent-2'),
    danger: css('--danger'),
    warn: css('--warn'),
    traffic: [css('--traffic-1'), css('--traffic-2'), css('--traffic-3'), css('--traffic-4')],
    truck: css('--traffic-truck'),
    obstacle: css('--warn'),
    ghost: css('--accent'),
    dead: css('--text-faint'),
    tree: css('--sim-tree'),
    building: css('--sim-building'),
  };
}

/**
 * Renders the latest worker frame with requestAnimationFrame, fully decoupled from the simulation rate.
 * The road is rebuilt locally from the (deterministic) environment config, so only vehicle poses cross
 * the worker boundary. The camera eases toward the focus car and looks ahead along its heading.
 */
export class SimRenderer {
  private ctx: CanvasRenderingContext2D;
  private road: Road | null = null;
  private roadKey = '';
  private palette = readPalette();
  private raf = 0;
  private cam = { x: 0, y: 0, init: false };
  private camLoc: RoadLocation = { index: -1, s: 0, d: 0 };
  private lastT = 0;
  private fpsFrames = 0;
  private fpsStart = 0;
  private ro: ResizeObserver;
  private width = 0;
  private height = 0;
  private dpr = 1;
  quality: ResolvedQuality = 'balanced';
  showSensors = true;
  zoom = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser.');
    this.ctx = ctx;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    window.addEventListener('themechange', this.onTheme);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('themechange', this.onTheme);
  }

  private onTheme = () => {
    this.palette = readPalette();
  };

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dpr);
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  setQuality(q: ResolvedQuality): void {
    this.quality = q;
    this.resize();
  }

  private ensureRoad(env: EnvironmentConfig): Road {
    const key = JSON.stringify(env);
    if (key !== this.roadKey || !this.road) {
      this.road = new Road(env);
      this.roadKey = key;
      this.camLoc.index = -1;
      this.cam.init = false;
    }
    return this.road;
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    const t0 = performance.now();
    this.draw(dt);
    const perf = controller.perf;
    perf.renderMs = perf.renderMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fpsFrames++;
    if (t - this.fpsStart >= 1000) {
      perf.fps = (this.fpsFrames * 1000) / (t - this.fpsStart);
      this.fpsFrames = 0;
      this.fpsStart = t;
    }
  };

  private draw(dt: number): void {
    const { ctx, palette: p } = this;
    const env = (controller.activeConfig ?? controller.config).env;
    const road = this.ensureRoad(env);
    const frame = controller.frame;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = p.ground;
    ctx.fillRect(0, 0, this.width, this.height);

    // Camera target: focus car, looking ahead along its heading.
    let tx = 0,
      ty = 0;
    const focus = frame?.focus;
    if (focus) {
      tx = focus.x + Math.sin(focus.angle) * this.height * 0.18;
      ty = focus.y - Math.cos(focus.angle) * this.height * 0.18;
    } else {
      const pose = { x: 0, y: 0, angle: 0 };
      road.pose(100 + this.height * 0.3, 0, pose);
      tx = pose.x;
      ty = pose.y;
    }
    if (!this.cam.init || Math.hypot(tx - this.cam.x, ty - this.cam.y) > 1500) {
      this.cam.x = tx;
      this.cam.y = ty;
      this.cam.init = true;
      this.camLoc.index = -1;
    } else {
      const k = 1 - Math.exp(-dt * 6);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }

    // Fit the road (plus margins) to the viewport width.
    const fit = this.width / (road.halfWidth * 2 + 160);
    const scale = Math.max(0.35, Math.min(1.6, fit)) * this.zoom;
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    road.locate(this.cam.x, this.cam.y, this.camLoc.index, this.camLoc);
    const span = Math.ceil(Math.hypot(this.width, this.height) / scale / 2 / ROAD_STEP) + 2;
    const lo = Math.max(0, this.camLoc.index - span),
      hi = Math.min(road.count - 1, this.camLoc.index + span);

    const q = QUALITY[this.quality];
    if (q.scenery) this.drawScenery(road, lo, hi);
    this.drawRoad(road, lo, hi);
    if (frame) {
      this.drawTraffic(frame);
      this.drawAgents(frame, q.ghosts, q.shadows);
      if (focus && this.showSensors) this.drawSensors(frame);
    }
  }

  private drawScenery(road: Road, lo: number, hi: number): void {
    const { ctx, palette: p } = this;
    for (const s of road.scenery) {
      if (s.index < lo || s.index > hi) continue;
      if (s.kind === 'tree') {
        ctx.fillStyle = p.tree;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.fillStyle = p.building;
        ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size * 1.3);
        ctx.restore();
      }
    }
  }

  private drawRoad(road: Road, lo: number, hi: number): void {
    const { ctx, palette: p } = this;
    // Surface
    ctx.fillStyle = p.road;
    ctx.beginPath();
    ctx.moveTo(road.lx[lo]!, road.ly[lo]!);
    for (let i = lo + 1; i <= hi; i++) ctx.lineTo(road.lx[i]!, road.ly[i]!);
    for (let i = hi; i >= lo; i--) ctx.lineTo(road.rx[i]!, road.ry[i]!);
    ctx.closePath();
    ctx.fill();

    // Lane markings (dashed), offset along the road so dashes are stable as the camera moves.
    const pose = { x: 0, y: 0, angle: 0 };
    ctx.strokeStyle = p.lane;
    ctx.lineWidth = 3;
    ctx.setLineDash([24, 26]);
    ctx.lineDashOffset = 0;
    for (let k = 1; k < road.laneCount; k++) {
      const d = -road.halfWidth + k * road.laneWidth;
      ctx.beginPath();
      for (let i = lo; i <= hi; i++) {
        road.pose(i * ROAD_STEP, d, pose);
        if (i === lo) ctx.moveTo(pose.x, pose.y);
        else ctx.lineTo(pose.x, pose.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Borders
    ctx.strokeStyle = p.edge;
    ctx.lineWidth = 5;
    for (const [xs, ys] of [
      [road.lx, road.ly],
      [road.rx, road.ry],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(xs[lo]!, ys[lo]!);
      for (let i = lo + 1; i <= hi; i++) ctx.lineTo(xs[i]!, ys[i]!);
      ctx.stroke();
    }

    // Distance markers (checkpoints) every CHECKPOINT_SPACING units from the start line.
    ctx.font = '600 14px Inter Variable, Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    const first = Math.ceil((lo * ROAD_STEP - 100) / CHECKPOINT_SPACING);
    for (let m = Math.max(0, first); 100 + m * CHECKPOINT_SPACING <= hi * ROAD_STEP; m++) {
      const s = 100 + m * CHECKPOINT_SPACING;
      const a = { x: 0, y: 0, angle: 0 },
        b = { x: 0, y: 0, angle: 0 };
      road.pose(s, -road.halfWidth, a);
      road.pose(s, road.halfWidth, b);
      ctx.strokeStyle = m === 0 ? p.accent : p.marker;
      ctx.lineWidth = m === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(a.angle);
      ctx.fillStyle = p.text;
      ctx.fillText(m === 0 ? 'START' : `${(m * CHECKPOINT_SPACING) / 10} m`, 10, 5);
      ctx.restore();
    }
  }

  private drawTraffic(frame: FrameMessage): void {
    const { ctx, palette: p } = this;
    const t = frame.traffic;
    for (let i = 0; i < t.length; i += 4) {
      const kind = t[i + 3]!;
      ctx.save();
      ctx.translate(t[i]!, t[i + 1]!);
      ctx.rotate(t[i + 2]!);
      if (kind === 2) {
        ctx.fillStyle = p.obstacle;
        ctx.fillRect(-22, -11, 44, 22);
        ctx.strokeStyle = p.road;
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let x = -22; x < 22; x += 11) {
          ctx.moveTo(x, 11);
          ctx.lineTo(x + 8, -11);
        }
        ctx.stroke();
      } else {
        const truck = kind === 1;
        const w = truck ? 34 : 30,
          l = truck ? 82 : 50;
        ctx.fillStyle = truck ? p.truck : p.traffic[(i / 4) % p.traffic.length]!;
        roundRect(ctx, -w / 2, -l / 2, w, l, 5);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-w / 2 + 4, -l / 2 + (truck ? 6 : 9), w - 8, truck ? 12 : 9); // windscreen
      }
      ctx.restore();
    }
  }

  private drawAgents(frame: FrameMessage, maxGhosts: number, shadows: boolean): void {
    const p = this.palette;
    const cars = frame.cars;
    const focusIdx = frame.focus?.index ?? -1;
    let drawn = 0;
    // Ghosts first (population), focus car last so it sits on top.
    for (let i = 0; i < cars.length / 4 && drawn < maxGhosts; i++) {
      if (i === focusIdx) continue;
      const status = cars[i * 4 + 3]!;
      if (status !== 0 && cars.length / 4 > 30) continue; // hide eliminated cars in big populations
      drawn++;
      this.drawCar(
        cars[i * 4]!,
        cars[i * 4 + 1]!,
        cars[i * 4 + 2]!,
        status === 0 ? p.ghost : p.dead,
        0.22,
        false,
      );
    }
    if (focusIdx >= 0) {
      const status = cars[focusIdx * 4 + 3]!;
      const color = status === 1 ? p.danger : controller.mode === 'manual' ? p.accent2 : p.accent;
      this.drawCar(cars[focusIdx * 4]!, cars[focusIdx * 4 + 1]!, cars[focusIdx * 4 + 2]!, color, 1, shadows);
    }
  }

  private drawCar(x: number, y: number, angle: number, color: string, alpha: number, shadow: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(ctx, -CAR_WIDTH / 2 + 3, -CAR_LENGTH / 2 + 4, CAR_WIDTH, CAR_LENGTH, 6);
      ctx.fill();
    }
    ctx.fillStyle = color;
    roundRect(ctx, -CAR_WIDTH / 2, -CAR_LENGTH / 2, CAR_WIDTH, CAR_LENGTH, 6);
    ctx.fill();
    if (alpha === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-CAR_WIDTH / 2 + 4, -CAR_LENGTH / 2 + 10, CAR_WIDTH - 8, 9);
      ctx.fillRect(-CAR_WIDTH / 2 + 5, CAR_LENGTH / 2 - 12, CAR_WIDTH - 10, 6);
    }
    ctx.restore();
  }

  private drawSensors(frame: FrameMessage): void {
    const f = frame.focus!;
    const { ctx, palette: p } = this;
    const colors = [p.accent2, p.warn, p.danger, p.warn];
    for (let r = 0; r < f.readings.length; r++) {
      const a = f.angle + rayOffset(r, f.sensors);
      const ex = f.x + Math.sin(a) * f.sensors.range,
        ey = f.y - Math.cos(a) * f.sensors.range;
      const hx = f.hits[r * 2]!,
        hy = f.hits[r * 2 + 1]!;
      const kind = f.hitKinds[r]!;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = p.accent2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      if (kind !== 0) {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = p.text;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors[kind]!;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.accent2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
