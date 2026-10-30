import { rectPolygon } from '../core/geometry';
import { Rng, deriveSeed } from '../core/rng';
import type { EnvironmentConfig, PhysicsConfig } from './config';
import type { Road } from './road';

export type TrafficKind = 'car' | 'truck' | 'obstacle';
export const TRAFFIC_KIND_CODE: Record<TrafficKind, number> = { car: 0, truck: 1, obstacle: 2 };

export interface TrafficVehicle {
  s0: number;
  lane: number;
  speed: number;
  kind: TrafficKind;
  width: number;
  length: number;
  s: number;
  x: number;
  y: number;
  angle: number;
  poly: Float64Array;
  /** Bounding radius for cheap distance rejection. */
  radius: number;
}

const DIMENSIONS: Record<TrafficKind, [number, number]> = {
  car: [30, 50],
  truck: [34, 82],
  obstacle: [44, 22],
};
const MIN_LANE_GAP = 120;

/**
 * Deterministic traffic. Every vehicle's position is a pure function of time: s(t) = s0 + v·t, and all
 * vehicles in a lane share that lane's speed, so vehicles never overlap and the scene is identical for
 * every run with the same seed regardless of when (or whether) a vehicle was materialised.
 * Vehicles are generated lazily in rows ahead of the agents and dropped once far behind.
 */
export class Traffic {
  readonly vehicles: TrafficVehicle[] = [];
  readonly active: TrafficVehicle[] = [];
  private readonly rng: Rng;
  private cursor = 380;
  private row = 0;
  private platoonLeft = 0;
  private readonly laneLast: number[];
  private readonly laneSpeed: number[];
  private readonly trafficLanes: number[];
  private readonly obstacleLanes: number[];
  private readonly pose = { x: 0, y: 0, angle: 0 };

  constructor(
    private readonly road: Road,
    private readonly env: EnvironmentConfig,
    physics: PhysicsConfig,
  ) {
    this.rng = new Rng(deriveSeed(env.seed, 3));
    const lanes = env.laneCount;
    this.laneLast = new Array<number>(lanes).fill(-Infinity);
    // Left lanes are slightly faster than right lanes, like a real highway.
    this.laneSpeed = Array.from({ length: lanes }, (_, i) => {
      const f = lanes > 1 ? 1 - i / (lanes - 1) : 0.5;
      return env.trafficSpeed * physics.maxSpeed * (0.9 + 0.2 * f);
    });
    const all = Array.from({ length: lanes }, (_, i) => i);
    if (env.obstacleDensity > 0) {
      // Obstacles and moving traffic use disjoint lanes so traffic never drives through a barrier.
      const split = Math.max(1, Math.floor(lanes / 2));
      this.trafficLanes = all.slice(0, split);
      this.obstacleLanes = all.slice(split);
    } else {
      this.trafficLanes = all;
      this.obstacleLanes = [];
    }
  }

  /** Materialises traffic for time `t` within the window around the agents. */
  update(t: number, minS: number, maxS: number): TrafficVehicle[] {
    const horizon = Math.min(maxS + 900, this.road.length - 250);
    while (this.cursor < horizon) this.generateRow();

    this.active.length = 0;
    const list = this.vehicles;
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i]!;
      v.s = v.s0 + v.speed * t;
      if (v.s < minS - 500 || v.s > this.road.length - 40) {
        list[i] = list[list.length - 1]!;
        list.pop();
        continue;
      }
      if (v.s > maxS + 700) continue;
      this.road.pose(v.s, this.road.laneCenter(v.lane), this.pose);
      v.x = this.pose.x;
      v.y = this.pose.y;
      v.angle = this.pose.angle;
      rectPolygon(v.x, v.y, v.angle, v.width, v.length, v.poly);
      this.active.push(v);
    }
    return this.active;
  }

  private generateRow(): void {
    const { env, rng } = this;
    const s = this.cursor;
    const base = 420 - 310 * env.trafficDensity;
    const obstacleRow = this.obstacleLanes.length > 0 && rng.next() < env.obstacleDensity * 0.6;

    if (obstacleRow) {
      const lanes = shuffle(rng, this.obstacleLanes);
      const k = Math.max(1, lanes.length - 1);
      for (let i = 0; i < k; i++) this.spawn(lanes[i]!, s, 'obstacle');
      this.cursor += rng.range(220, 420) * (1.4 - env.obstacleDensity * 0.6);
    } else if (env.trafficDensity > 0) {
      const lanes = shuffle(rng, this.trafficLanes);
      // Never fill every lane of the road in a single row: there is always a way through.
      const maxK = this.trafficLanes.length === env.laneCount ? Math.max(1, lanes.length - 1) : lanes.length;
      let k: number;
      let spacing: number;
      switch (env.pattern) {
        case 'staggered':
          k = 1;
          lanes[0] = this.trafficLanes[this.row % this.trafficLanes.length]!;
          spacing = base * 0.75;
          break;
        case 'platoon':
          k = maxK;
          if (this.platoonLeft <= 0) this.platoonLeft = rng.int(2, 4);
          this.platoonLeft--;
          spacing = this.platoonLeft === 0 ? base * 2.6 : base * 0.55;
          break;
        default:
          k = rng.int(1, maxK);
          spacing = base * rng.range(0.6, 1.4);
      }
      for (let i = 0; i < k; i++)
        this.spawn(lanes[i]!, s + rng.range(-10, 10), rng.next() < 0.18 ? 'truck' : 'car');
      this.cursor += Math.max(MIN_LANE_GAP * 0.6, spacing);
    } else {
      this.cursor += 400;
    }
    this.row++;
  }

  private spawn(lane: number, s0: number, kind: TrafficKind): void {
    if (s0 - this.laneLast[lane]! < MIN_LANE_GAP) return;
    this.laneLast[lane] = s0;
    const [width, length] = DIMENSIONS[kind];
    this.vehicles.push({
      s0,
      lane,
      speed: kind === 'obstacle' ? 0 : this.laneSpeed[lane]!,
      kind,
      width,
      length,
      s: s0,
      x: 0,
      y: 0,
      angle: 0,
      poly: new Float64Array(8),
      radius: Math.hypot(width, length) / 2,
    });
  }
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
