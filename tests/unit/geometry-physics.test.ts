import { describe, expect, it } from 'vitest';
import { polygonsIntersect, rectPolygon, segmentIntersect } from '../../src/core/geometry';
import { Car, outputsToControls, stepPhysics } from '../../src/simulation/car';
import { defaultConfig, FIXED_DT, presetEnv } from '../../src/simulation/config';
import { Road } from '../../src/simulation/road';
import { castRays, HIT_BORDER, HIT_NONE, HIT_VEHICLE } from '../../src/simulation/sensor';
import type { TrafficVehicle } from '../../src/simulation/traffic';

describe('geometry', () => {
  it('finds segment intersections', () => {
    expect(segmentIntersect(0, 0, 10, 0, 5, -5, 5, 5)).toBeCloseTo(0.5);
    expect(segmentIntersect(0, 0, 10, 0, 0, 1, 10, 1)).toBe(-1); // parallel
    expect(segmentIntersect(0, 0, 10, 0, 15, -5, 15, 5)).toBe(-1); // beyond the end
  });

  it('detects polygon collisions including containment', () => {
    const a = rectPolygon(0, 0, 0, 30, 50, new Float64Array(8));
    const b = rectPolygon(20, 0, 0.3, 30, 50, new Float64Array(8));
    const far = rectPolygon(100, 0, 0, 30, 50, new Float64Array(8));
    const inner = rectPolygon(0, 0, 0, 4, 4, new Float64Array(8));
    expect(polygonsIntersect(a, b)).toBe(true);
    expect(polygonsIntersect(a, far)).toBe(false);
    expect(polygonsIntersect(a, inner)).toBe(true);
  });

  it('builds rotated rectangles with forward = -y at angle 0', () => {
    const p = rectPolygon(0, 0, 0, 2, 4, new Float64Array(8));
    expect(Math.min(p[1]!, p[3]!, p[5]!, p[7]!)).toBeCloseTo(-2);
    const q = rectPolygon(0, 0, Math.PI / 2, 2, 4, new Float64Array(8));
    expect(Math.max(q[0]!, q[2]!, q[4]!, q[6]!)).toBeCloseTo(2); // now facing +x
  });
});

describe('vehicle physics', () => {
  const p = defaultConfig().physics;
  const run = (car: Car, c: { throttle: number; brake: number; steer: number }, seconds: number) => {
    for (let t = 0; t < seconds; t += FIXED_DT) stepPhysics(car, c, p, FIXED_DT);
  };

  it('accelerates, respects the speed limit and keeps momentum', () => {
    const car = new Car(0, 0, 0, 1);
    run(car, { throttle: 1, brake: 0, steer: 0 }, 1);
    expect(car.speed).toBeCloseTo(p.acceleration - p.friction, 0);
    expect(car.y).toBeLessThan(0);
    run(car, { throttle: 1, brake: 0, steer: 0 }, 10);
    expect(car.speed).toBe(p.maxSpeed);
    const v = car.speed;
    stepPhysics(car, { throttle: 0, brake: 0, steer: 0 }, p, FIXED_DT);
    expect(car.speed).toBeCloseTo(v - p.friction * FIXED_DT); // coasts, only friction
  });

  it('brakes to a stop then reverses, capped at max reverse speed', () => {
    const car = new Car(0, 0, 0, 1);
    car.speed = 200;
    run(car, { throttle: 0, brake: 1, steer: 0 }, 0.4);
    expect(car.speed).toBeLessThan(200 - p.brakeDeceleration * 0.3);
    run(car, { throttle: 0, brake: 1, steer: 0 }, 5);
    expect(car.speed).toBe(-p.maxReverseSpeed);
  });

  it('cannot steer while stationary and steers right with positive input', () => {
    const car = new Car(0, 0, 0, 1);
    run(car, { throttle: 0, brake: 0, steer: 1 }, 1);
    expect(car.angle).toBe(0);
    car.speed = 150;
    run(car, { throttle: 0, brake: 0, steer: 1 }, 0.2);
    expect(car.angle).toBeGreaterThan(0);
  });

  it('maps network outputs to controls with a 0.5 threshold', () => {
    const c = outputsToControls([0.9, 0.2, 0.7, 0.1], { throttle: 0, brake: 0, steer: 0 });
    expect(c).toEqual({ throttle: 1, brake: 0, steer: 1 });
  });
});

describe('sensors', () => {
  const cfg = defaultConfig();
  const road = new Road(presetEnv('highway'));

  function carAt(d: number, s = 500): Car {
    const pose = { x: 0, y: 0, angle: 0 };
    road.pose(s, d, pose);
    const car = new Car(pose.x, pose.y, pose.angle, cfg.sensors.rayCount);
    road.locate(car.x, car.y, -1, car.loc);
    return car;
  }

  it('measures the distance to the road border along a sideways ray', () => {
    const car = carAt(0);
    const sideways = { rayCount: 1, range: 170, fov: 10 };
    car.angle = Math.PI / 2; // face right
    const single = new Car(car.x, car.y, car.angle, 1);
    single.loc.index = car.loc.index;
    castRays(single, road, [], sideways);
    expect(single.hitKinds[0]).toBe(HIT_BORDER);
    // border is halfWidth (90) away → reading = 1 - 90/170
    expect(single.readings[0]).toBeCloseTo(1 - road.halfWidth / 170, 5);
    expect(single.hits[0]).toBeCloseTo(car.x + road.halfWidth, 5);
  });

  it('reports 0 for rays that hit nothing and detects vehicles ahead', () => {
    const car = carAt(0);
    castRays(car, road, [], cfg.sensors);
    const mid = Math.floor(cfg.sensors.rayCount / 2);
    expect(car.hitKinds[mid]).toBe(HIT_NONE);
    expect(car.readings[mid]).toBe(0);

    const ahead: TrafficVehicle = {
      s0: 0,
      lane: 1,
      speed: 0,
      kind: 'car',
      width: 30,
      length: 50,
      s: 0,
      x: car.x,
      y: car.y - 100,
      angle: 0,
      poly: new Float64Array(8),
      radius: 30,
    };
    rectPolygon(ahead.x, ahead.y, 0, 30, 50, ahead.poly);
    castRays(car, road, [ahead], cfg.sensors);
    expect(car.hitKinds[mid]).toBe(HIT_VEHICLE);
    expect(car.readings[mid]).toBeCloseTo(1 - 75 / 170, 5); // rear bumper at 100 - 25
  });

  it('spreads rays across the configured field of view', () => {
    const car = carAt(0);
    castRays(car, road, [], { rayCount: 7, range: 170, fov: 108 });
    const first = Math.atan2(car.hits[0]! - car.x, -(car.hits[1]! - car.y));
    const last = Math.atan2(car.hits[12]! - car.x, -(car.hits[13]! - car.y));
    expect(((last - first) * 180) / Math.PI).toBeCloseTo(108, 3); // hit points are Float32
  });
});
