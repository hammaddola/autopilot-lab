import { polygonsIntersect, segmentIntersect } from '../core/geometry';
import { Car, stepPhysics, type Controls } from './car';
import { CHECKPOINT_SPACING, type SensorConfig, type SimConfig } from './config';
import { Road } from './road';
import { castRays } from './sensor';
import { Traffic } from './traffic';

export type DecideFn = (car: Car, index: number) => Controls;

export interface WorldOptions {
  /** Seconds without forward progress before a car is eliminated (Infinity disables). */
  stallSeconds: number;
  /** Episode length in simulated seconds (Infinity disables). */
  maxSeconds: number;
}

/**
 * One episode: a road, its deterministic traffic, and a set of agents. AI cars do not collide with
 * each other (each is evaluated independently against the same scenario).
 */
export class World {
  readonly road: Road;
  readonly traffic: Traffic;
  readonly cars: Car[] = [];
  time = 0;
  steps = 0;
  private aliveCount = 0;

  /** Per-car sensor configuration (drivers under test may use different rigs). */
  readonly sensors: SensorConfig[];

  constructor(
    readonly config: SimConfig,
    agentCount: number,
    readonly options: WorldOptions,
    road?: Road,
    sensors?: SensorConfig[],
  ) {
    this.sensors = Array.from({ length: agentCount }, (_, i) => sensors?.[i] ?? config.sensors);
    this.road = road ?? new Road(config.env);
    this.traffic = new Traffic(this.road, config.env, config.physics);
    const start = { x: 0, y: 0, angle: 0 };
    const startS = 100;
    this.road.pose(startS, this.road.laneCenter(Math.floor((config.env.laneCount - 1) / 2)), start);
    for (let i = 0; i < agentCount; i++) {
      const car = new Car(start.x, start.y, start.angle, this.sensors[i]!.rayCount);
      this.road.locate(car.x, car.y, -1, car.loc);
      car.bestS = car.startS = car.loc.s;
      this.cars.push(car);
    }
    this.aliveCount = agentCount;
    this.traffic.update(0, startS, startS);
  }

  get alive(): number {
    return this.aliveCount;
  }

  get done(): boolean {
    return this.aliveCount === 0;
  }

  /** Advances the world by one fixed timestep. */
  step(dt: number, decide: DecideFn): void {
    const { cars, road, config } = this;
    let minS = Infinity,
      maxS = -Infinity;
    for (const c of cars) {
      if (!c.alive) continue;
      if (c.loc.s < minS) minS = c.loc.s;
      if (c.loc.s > maxS) maxS = c.loc.s;
    }
    if (minS === Infinity) return;
    const active = this.traffic.update(this.time, minS, maxS);
    this.time += dt;
    this.steps++;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      if (!car.alive) continue;
      castRays(car, road, active, this.sensors[i]!);
      const c = decide(car, i);
      car.controls.throttle = c.throttle;
      car.controls.brake = c.brake;
      car.controls.steer = c.steer;
      stepPhysics(car, car.controls, config.physics, dt);
      road.locate(car.x, car.y, car.loc.index, car.loc);
      car.time += dt;

      // Statistics
      car.samples++;
      car.speedSum += Math.max(0, car.speed);
      const lane = Math.max(
        0,
        Math.min(road.laneCount - 1, Math.floor((car.loc.d + road.halfWidth) / road.laneWidth)),
      );
      car.laneDevSum += Math.min(1, Math.abs(car.loc.d - road.laneCenter(lane)) / (road.laneWidth / 2));
      if (car.loc.s > car.bestS + 1) {
        car.bestS = car.loc.s;
        car.lastProgressTime = car.time;
      }

      if (this.hitsBorder(car)) this.eliminate(car, 'crashed', 'border');
      else {
        for (const tv of active) {
          if (Math.abs(tv.x - car.x) > 90 || Math.abs(tv.y - car.y) > 90) continue;
          if (polygonsIntersect(car.poly, tv.poly)) {
            this.eliminate(car, 'crashed', tv.kind === 'obstacle' ? 'obstacle' : 'vehicle');
            break;
          }
        }
      }
      if (!car.alive) continue;
      if (car.loc.s >= road.length - 120) this.eliminate(car, 'finished');
      else if (car.time - car.lastProgressTime > this.options.stallSeconds) this.eliminate(car, 'stalled');
      else if (car.time >= this.options.maxSeconds) this.eliminate(car, 'timeout');
    }
  }

  checkpoints(car: Car): number {
    return Math.floor(car.distance / CHECKPOINT_SPACING);
  }

  private eliminate(car: Car, status: Car['status'], cause: Car['crashedInto'] = null): void {
    car.status = status;
    car.crashedInto = cause;
    this.aliveCount--;
  }

  private hitsBorder(car: Car): boolean {
    const road = this.road;
    // Cheap reject: comfortably inside the lanes.
    if (Math.abs(car.loc.d) < road.halfWidth - 32) return false;
    if (Math.abs(car.loc.d) > road.halfWidth + 40) return true;
    const lo = Math.max(0, car.loc.index - 3),
      hi = Math.min(road.count - 2, car.loc.index + 3);
    const p = car.poly;
    for (let e = 0; e < 8; e += 2) {
      const n = (e + 2) & 7;
      for (let i = lo; i <= hi; i++) {
        if (
          segmentIntersect(
            p[e]!,
            p[e + 1]!,
            p[n]!,
            p[n + 1]!,
            road.lx[i]!,
            road.ly[i]!,
            road.lx[i + 1]!,
            road.ly[i + 1]!,
          ) >= 0
        )
          return true;
        if (
          segmentIntersect(
            p[e]!,
            p[e + 1]!,
            p[n]!,
            p[n + 1]!,
            road.rx[i]!,
            road.ry[i]!,
            road.rx[i + 1]!,
            road.ry[i + 1]!,
          ) >= 0
        )
          return true;
      }
    }
    return false;
  }
}
