import { clamp, rectPolygon } from '../core/geometry';
import type { PhysicsConfig } from './config';
import type { RoadLocation } from './road';

export interface Controls {
  /** 0..1 */
  throttle: number;
  /** 0..1 — also reverses once stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
}

export type CarStatus = 'alive' | 'crashed' | 'stalled' | 'finished' | 'timeout';

export const CAR_WIDTH = 30;
export const CAR_LENGTH = 50;

export class Car {
  x: number;
  y: number;
  angle: number;
  speed = 0;
  readonly poly = new Float64Array(8);
  status: CarStatus = 'alive';
  readonly loc: RoadLocation = { index: 0, s: 0, d: 0 };
  readonly controls: Controls = { throttle: 0, brake: 0, steer: 0 };

  // Per-episode statistics used by the fitness function.
  bestS = 0;
  startS = 0;
  lastProgressTime = 0;
  time = 0;
  speedSum = 0;
  laneDevSum = 0;
  samples = 0;
  crashedInto: 'border' | 'vehicle' | 'obstacle' | null = null;

  readonly readings: Float64Array;
  readonly hits: Float32Array;
  /** 0 none, 1 border, 2 vehicle, 3 obstacle */
  readonly hitKinds: Uint8Array;

  constructor(x: number, y: number, angle: number, rayCount: number) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.readings = new Float64Array(rayCount);
    this.hits = new Float32Array(rayCount * 2);
    this.hitKinds = new Uint8Array(rayCount);
    this.updatePolygon();
  }

  get alive(): boolean {
    return this.status === 'alive';
  }

  get distance(): number {
    return Math.max(0, this.bestS - this.startS);
  }

  updatePolygon(): void {
    rectPolygon(this.x, this.y, this.angle, CAR_WIDTH, CAR_LENGTH, this.poly);
  }
}

/**
 * Semi-implicit kinematic bicycle-ish model:
 * speed integrates throttle/brake/friction (momentum is retained between steps), steering rate scales with
 * speed so a stationary car cannot spin, and steering flips when reversing.
 */
export function stepPhysics(car: Car, c: Controls, p: PhysicsConfig, dt: number): void {
  const throttle = clamp(c.throttle, 0, 1);
  const brake = clamp(c.brake, 0, 1);
  const steer = clamp(c.steer, -1, 1);
  let v = car.speed;

  v += p.acceleration * throttle * dt;
  if (brake > 0) {
    // Brake while moving forward; once (nearly) stopped the brake pedal engages reverse.
    v -= (v > 1 ? p.brakeDeceleration : p.acceleration * 0.5) * brake * dt;
  }
  // Rolling friction always opposes motion and never flips the direction of travel.
  const f = p.friction * dt;
  if (v > 0) v = Math.max(0, v - f);
  else if (v < 0) v = Math.min(0, v + f);
  v = clamp(v, -p.maxReverseSpeed, p.maxSpeed);

  if (v !== 0) {
    const grip = Math.min(1, Math.abs(v) / 60);
    car.angle += steer * p.steerRate * grip * Math.sign(v) * dt;
  }
  car.speed = v;
  car.x += Math.sin(car.angle) * v * dt;
  car.y -= Math.cos(car.angle) * v * dt;
  car.updatePolygon();
}

/** Maps the 4 network outputs (sigmoid, 0..1) to controls. Outputs above 0.5 engage the control. */
export function outputsToControls(out: ArrayLike<number>, target: Controls): Controls {
  target.throttle = out[0]! > 0.5 ? 1 : 0;
  const left = out[1]! > 0.5 ? 1 : 0;
  const right = out[2]! > 0.5 ? 1 : 0;
  target.steer = right - left;
  target.brake = out[3]! > 0.5 ? 1 : 0;
  return target;
}
