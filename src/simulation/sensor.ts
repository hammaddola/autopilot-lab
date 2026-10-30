import { segmentIntersect } from '../core/geometry';
import type { Car } from './car';
import type { SensorConfig } from './config';
import { ROAD_STEP, type Road } from './road';
import type { TrafficVehicle } from './traffic';

export const HIT_NONE = 0;
export const HIT_BORDER = 1;
export const HIT_VEHICLE = 2;
export const HIT_OBSTACLE = 3;
export const HIT_LABELS = ['None', 'Road border', 'Vehicle', 'Obstacle'] as const;

/** Angle of ray `i` relative to the car heading, left (−) to right (+). */
export function rayOffset(i: number, cfg: SensorConfig): number {
  if (cfg.rayCount === 1) return 0;
  const fov = (cfg.fov * Math.PI) / 180;
  return -fov / 2 + (fov * i) / (cfg.rayCount - 1);
}

/**
 * Casts rays from the car centre and writes normalised readings into `car.readings`:
 * 0 = nothing within range, → 1 as the hit approaches the car. Only border segments near the car's
 * road index and traffic within range are tested, so the cost is independent of road length.
 */
export function castRays(car: Car, road: Road, traffic: readonly TrafficVehicle[], cfg: SensorConfig): void {
  const { x, y } = car;
  const range = cfg.range;
  const k = Math.ceil(range / ROAD_STEP) + 1;
  const lo = Math.max(0, car.loc.index - k);
  const hi = Math.min(road.count - 2, car.loc.index + k);
  const reach = range + 50;

  for (let r = 0; r < cfg.rayCount; r++) {
    const a = car.angle + rayOffset(r, cfg);
    const ex = x + Math.sin(a) * range;
    const ey = y - Math.cos(a) * range;
    let best = 1;
    let kind = HIT_NONE;

    for (let i = lo; i <= hi; i++) {
      let t = segmentIntersect(x, y, ex, ey, road.lx[i]!, road.ly[i]!, road.lx[i + 1]!, road.ly[i + 1]!);
      if (t >= 0 && t < best) {
        best = t;
        kind = HIT_BORDER;
      }
      t = segmentIntersect(x, y, ex, ey, road.rx[i]!, road.ry[i]!, road.rx[i + 1]!, road.ry[i + 1]!);
      if (t >= 0 && t < best) {
        best = t;
        kind = HIT_BORDER;
      }
    }

    for (let v = 0; v < traffic.length; v++) {
      const tv = traffic[v]!;
      const dx = tv.x - x,
        dy = tv.y - y;
      if (dx * dx + dy * dy > (reach + tv.radius) * (reach + tv.radius)) continue;
      const p = tv.poly;
      for (let e = 0; e < 8; e += 2) {
        const n = (e + 2) & 7;
        const t = segmentIntersect(x, y, ex, ey, p[e]!, p[e + 1]!, p[n]!, p[n + 1]!);
        if (t >= 0 && t < best) {
          best = t;
          kind = tv.kind === 'obstacle' ? HIT_OBSTACLE : HIT_VEHICLE;
        }
      }
    }

    car.readings[r] = kind === HIT_NONE ? 0 : 1 - best;
    car.hits[r * 2] = x + (ex - x) * best;
    car.hits[r * 2 + 1] = y + (ey - y) * best;
    car.hitKinds[r] = kind;
  }
}
