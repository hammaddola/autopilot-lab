import { Rng, deriveSeed } from '../core/rng';
import type { EnvironmentConfig } from './config';

export const ROAD_STEP = 20;

export interface Scenery {
  index: number;
  x: number;
  y: number;
  size: number;
  angle: number;
  kind: 'tree' | 'building';
}

export interface RoadLocation {
  index: number;
  s: number;
  d: number;
}

/**
 * Road defined by a sampled centreline. Position along the road is the arc length `s`;
 * lateral offset `d` is positive to the right of the travel direction.
 * Borders and lane centres are derived from the centreline so curves come for free.
 */
export class Road {
  readonly count: number;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly heading: Float64Array;
  /** Border polylines: left (d = -half) and right (d = +half). */
  readonly lx: Float64Array;
  readonly ly: Float64Array;
  readonly rx: Float64Array;
  readonly ry: Float64Array;
  readonly halfWidth: number;
  readonly laneWidth: number;
  readonly laneCount: number;
  readonly length: number;
  readonly scenery: Scenery[];

  constructor(readonly env: EnvironmentConfig) {
    this.laneCount = env.laneCount;
    this.laneWidth = env.laneWidth;
    this.halfWidth = (env.laneCount * env.laneWidth) / 2;
    this.count = Math.ceil(env.roadLength / ROAD_STEP) + 1;
    this.length = (this.count - 1) * ROAD_STEP;
    const n = this.count;
    this.cx = new Float64Array(n);
    this.cy = new Float64Array(n);
    this.heading = new Float64Array(n);
    this.lx = new Float64Array(n);
    this.ly = new Float64Array(n);
    this.rx = new Float64Array(n);
    this.ry = new Float64Array(n);

    const curvature = buildCurvature(env, n);
    let x = 0,
      y = 0,
      h = 0;
    for (let i = 0; i < n; i++) {
      this.cx[i] = x;
      this.cy[i] = y;
      this.heading[i] = h;
      const c = Math.cos(h),
        s = Math.sin(h);
      this.lx[i] = x - c * this.halfWidth;
      this.ly[i] = y - s * this.halfWidth;
      this.rx[i] = x + c * this.halfWidth;
      this.ry[i] = y + s * this.halfWidth;
      h += (curvature[i] ?? 0) * ROAD_STEP;
      x += Math.sin(h) * ROAD_STEP;
      y -= Math.cos(h) * ROAD_STEP;
    }
    this.scenery = buildScenery(this, env);
  }

  laneCenter(lane: number): number {
    return -this.halfWidth + this.laneWidth * (lane + 0.5);
  }

  /** World pose of a point at arc length `s`, lateral offset `d`. */
  pose(s: number, d: number, out: { x: number; y: number; angle: number }): void {
    const f = Math.max(0, Math.min(this.count - 1.001, s / ROAD_STEP));
    const i = Math.floor(f),
      t = f - i;
    const h = this.heading[i]! + (this.heading[i + 1]! - this.heading[i]!) * t;
    const x = this.cx[i]! + (this.cx[i + 1]! - this.cx[i]!) * t;
    const y = this.cy[i]! + (this.cy[i + 1]! - this.cy[i]!) * t;
    out.x = x + Math.cos(h) * d;
    out.y = y + Math.sin(h) * d;
    out.angle = h;
  }

  /** Projects a world point onto the road. `hint` is the previous index (local search keeps it O(1)). */
  locate(x: number, y: number, hint: number, out: RoadLocation): RoadLocation {
    let lo = hint - 3,
      hi = hint + 6;
    if (hint < 0) {
      lo = 0;
      hi = this.count - 1;
    }
    lo = Math.max(0, lo);
    hi = Math.min(this.count - 1, hi);
    let best = lo,
      bestD = Infinity;
    for (let i = lo; i <= hi; i++) {
      const dx = x - this.cx[i]!,
        dy = y - this.cy[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    const h = this.heading[best]!;
    const dx = x - this.cx[best]!,
      dy = y - this.cy[best]!;
    const along = dx * Math.sin(h) - dy * Math.cos(h);
    out.index = best;
    out.s = Math.max(0, best * ROAD_STEP + along);
    out.d = dx * Math.cos(h) + dy * Math.sin(h);
    return out;
  }
}

/** Per-sample curvature (rad / unit) for the chosen layout; heading is kept within bounds so the road never loops back. */
function buildCurvature(env: EnvironmentConfig, n: number): Float64Array {
  const k = new Float64Array(n);
  if (env.layout === 'straight') return k;
  const rng = new Rng(deriveSeed(env.seed, 1));
  const maxHeading = env.layout === 'urban' ? 1.2 : 0.9;
  let i = Math.ceil(600 / ROAD_STEP);
  let heading = 0;
  while (i < n) {
    const straight = env.layout === 'urban' ? rng.range(300, 800) : rng.range(200, 700);
    i += Math.ceil(straight / ROAD_STEP);
    const radius = env.layout === 'urban' ? rng.range(260, 340) : rng.range(550, 1100);
    const turn = env.layout === 'urban' ? rng.range(0.6, 1.0) : rng.range(0.3, 0.8);
    let dir = rng.next() < 0.5 ? -1 : 1;
    if (Math.abs(heading + dir * turn) > maxHeading) dir = -dir;
    const steps = Math.ceil((turn * radius) / ROAD_STEP);
    const per = (dir * turn) / (steps * ROAD_STEP);
    for (let j = 0; j < steps && i < n; j++, i++) k[i] = per;
    heading += dir * turn;
  }
  return k;
}

function buildScenery(road: Road, env: EnvironmentConfig): Scenery[] {
  const rng = new Rng(deriveSeed(env.seed, 2));
  const items: Scenery[] = [];
  const urban = env.layout === 'urban';
  const every = urban ? 4 : 3;
  const pose = { x: 0, y: 0, angle: 0 };
  for (let i = 2; i < road.count; i += every) {
    for (const side of [-1, 1]) {
      if (rng.next() > (urban ? 0.85 : 0.45)) continue;
      const size = urban ? rng.range(40, 70) : rng.range(10, 22);
      const d = side * (road.halfWidth + (urban ? 25 + size / 2 : rng.range(30, 160)));
      road.pose(i * ROAD_STEP, d, pose);
      items.push({
        index: i,
        x: pose.x,
        y: pose.y,
        size,
        angle: pose.angle,
        kind: urban ? 'building' : 'tree',
      });
    }
  }
  return items;
}
