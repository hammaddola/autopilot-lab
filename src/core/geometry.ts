export interface Point {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Segment–segment intersection. Returns the parameter `t` along AB (0..1) or -1 when there is none.
 * Allocation-free so it can run millions of times per second in the sensor loop.
 */
export function segmentIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const rX = bx - ax,
    rY = by - ay,
    sX = dx - cx,
    sY = dy - cy;
  const den = rX * sY - rY * sX;
  if (den === 0) return -1;
  const qX = cx - ax,
    qY = cy - ay;
  const t = (qX * sY - qY * sX) / den;
  const u = (qX * rY - qY * rX) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** Polygons are flat arrays [x0,y0,x1,y1,...]. */
export function polygonsIntersect(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  const na = a.length,
    nb = b.length;
  for (let i = 0; i < na; i += 2) {
    const j = (i + 2) % na;
    for (let k = 0; k < nb; k += 2) {
      const l = (k + 2) % nb;
      if (segmentIntersect(a[i]!, a[i + 1]!, a[j]!, a[j + 1]!, b[k]!, b[k + 1]!, b[l]!, b[l + 1]!) >= 0)
        return true;
    }
  }
  // Edges don't cross: one polygon may still be fully inside the other.
  return pointInPolygon(a[0]!, a[1]!, b) || pointInPolygon(b[0]!, b[1]!, a);
}

export function pointInPolygon(x: number, y: number, poly: ArrayLike<number>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]!,
      yi = poly[i + 1]!,
      xj = poly[j]!,
      yj = poly[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Writes the 4 corners of an oriented rectangle (heading 0 = facing -y) into `out`. */
export function rectPolygon(
  x: number,
  y: number,
  angle: number,
  width: number,
  length: number,
  out: Float64Array,
): Float64Array {
  const hw = width / 2,
    hl = length / 2;
  const s = Math.sin(angle),
    c = Math.cos(angle);
  // Local (lx, ly) -> world: x + lx*c - ly*s ... with forward = (sin, -cos).
  const corners = [-hw, -hl, hw, -hl, hw, hl, -hw, hl];
  for (let i = 0; i < 8; i += 2) {
    const lx = corners[i]!,
      ly = corners[i + 1]!;
    out[i] = x + lx * c - ly * s;
    out[i + 1] = y + lx * s + ly * c;
  }
  return out;
}
