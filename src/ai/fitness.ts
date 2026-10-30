import type { FitnessWeights } from '../simulation/config';

export interface DriveStats {
  /** Forward progress along the road in simulation units. */
  distance: number;
  checkpoints: number;
  /** Mean forward speed in units/s. */
  avgSpeed: number;
  /** Seconds the car stayed in the episode. */
  time: number;
  crashed: boolean;
  /** Mean normalised distance from the nearest lane centre, 0 (centred) .. 1 (on a lane line). */
  laneDeviation: number;
}

export interface FitnessContext {
  maxSpeed: number;
  episodeSeconds: number;
}

/**
 * F = w_d·D/100 + w_c·C + w_s·S̄·[no crash] + w_t·T_eff − w_col·[crash] − w_l·L
 *
 * D distance (units), C checkpoints, S̄ mean speed / max speed, T_eff fraction of the episode survived
 * (productive time — stalled cars are eliminated early so idling earns nothing), L lane deviation.
 * Speed is only rewarded for drivers that did not crash, so the optimiser cannot trade safety for pace.
 */
export function computeFitness(s: DriveStats, w: FitnessWeights, ctx: FitnessContext): number {
  const speedTerm = s.crashed ? 0 : w.speed * Math.max(0, s.avgSpeed / ctx.maxSpeed);
  const timeTerm = w.time * Math.min(1, s.time / ctx.episodeSeconds);
  const f =
    (w.distance * s.distance) / 100 +
    w.checkpoints * s.checkpoints +
    speedTerm +
    timeTerm -
    (s.crashed ? w.collision : 0) -
    w.lane * s.laneDeviation;
  return Number.isFinite(f) ? f : 0;
}
