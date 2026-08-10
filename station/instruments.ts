/* Instrument drawing mathematics — the dial's needle and arc, the rose's
 * petals and judgment ring, the sparkline's scale and run-splitting — as
 * coordinates and path strings, never markup, the same promise geometry.ts
 * makes for the chart. Both bindings draw these instruments from the same
 * numbers, so their SVGs can never disagree.
 *
 * Names carry an instrument prefix (DIAL_, ROSE_, SPARKLINE_): these join
 * the station root's one flat namespace, where a bare CENTRE or polar would
 * say nothing about whose centre it is. */
import type { HistoryPoint } from "./contract.js";
import { COMPASS_POINTS, KMH_PER_MPS, normalizeDegrees, radians, speedToMps } from "./derive.js";
import type { SpeedUnit } from "./derive.js";
import { HISTORY_GAP_TOLERANCE_FACTOR } from "./geometry.js";

/* ---------- the dial ---------- */

/* The dial geometry is fixed at the classic 160-unit viewBox — a rendered
 * `size` scales the box, never the drawing math, so every class keeps the
 * proportions styles.css was written against. */
export const DIAL_SIZE = 160;
export const DIAL_CENTRE = DIAL_SIZE / 2;
export const DIAL_RING_RADIUS = 70;
export const DIAL_TICK_INNER = 64;
export const DIAL_CARDINAL_TICK_INNER = 58;
export const DIAL_LETTER_RADIUS = 46;
export const DIAL_HUB_RADIUS = 36;
const DIAL_NEEDLE_REACH = 60;
const DIAL_NEEDLE_HALF_WIDTH = 5;
export const DIAL_COUNTERWEIGHT_RADIUS = 4.5;
export const DIAL_COUNTERWEIGHT_REACH = 46;
/* The arc scales against at least this (the historical 40 km/h floor,
 * expressed in wire m/s), so light air never fills the ring. */
export const DIAL_MIN_MAX_MPS = 40 / KMH_PER_MPS;

export function dialPolar(bearingDeg: number, radius: number): readonly [number, number] {
  const angle = radians(bearingDeg);
  return [DIAL_CENTRE + Math.sin(angle) * radius, DIAL_CENTRE - Math.cos(angle) * radius];
}

const dialAt = ([x, y]: readonly [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;

/* Filled tapered blade from the hub to the downwind rim; the counterweight
 * circle sits opposite, outside the hub. */
export function dialNeedlePoints(fromDeg: number): string {
  const flowDeg = fromDeg + 180;
  const tip = dialPolar(flowDeg, DIAL_NEEDLE_REACH);
  const left = [
    DIAL_CENTRE + Math.sin(radians(flowDeg + 90)) * DIAL_NEEDLE_HALF_WIDTH,
    DIAL_CENTRE - Math.cos(radians(flowDeg + 90)) * DIAL_NEEDLE_HALF_WIDTH,
  ] as const;
  const right = [
    DIAL_CENTRE + Math.sin(radians(flowDeg - 90)) * DIAL_NEEDLE_HALF_WIDTH,
    DIAL_CENTRE - Math.cos(radians(flowDeg - 90)) * DIAL_NEEDLE_HALF_WIDTH,
  ] as const;
  return `${dialAt(tip)} ${dialAt(left)} ${dialAt(right)}`;
}

/* Gauge arc clockwise from the scale start at N; fraction 1 closes the ring. */
export function dialSpeedArcPath(fraction: number): string {
  const sweepDeg = Math.min(359.9, Math.max(0, fraction) * 360);
  const start = dialPolar(0, DIAL_RING_RADIUS);
  const end = dialPolar(sweepDeg, DIAL_RING_RADIUS);
  return `M ${start[0].toFixed(1)} ${start[1].toFixed(1)} A ${DIAL_RING_RADIUS} ${DIAL_RING_RADIUS} 0 ${
    sweepDeg > 180 ? 1 : 0
  } 1 ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
}

/* Arc scale: a sane fixed floor, or the gust rounded up to the next nice
 * DISPLAY-unit step (ten in the display unit, so a knots dial tops out at a
 * round knots number) — the needle's ring never saturates on an ordinary
 * day. A semantics rule, not styling, so every binding scales alike. */
export function dialScaleMaxMps(
  averageMps: number | null,
  gustMps: number | null,
  unit: SpeedUnit,
): number {
  const stepMps = speedToMps(10, unit);
  return Math.max(
    DIAL_MIN_MAX_MPS,
    Math.ceil(Math.max(gustMps ?? 0, averageMps ?? 0) / stepMps) * stepMps,
  );
}

/* Dial letters come from the same vocabulary compassDirection speaks. */
export const DIAL_CARDINALS = [
  { bearing: 0, letter: COMPASS_POINTS[0] },
  { bearing: 90, letter: COMPASS_POINTS[4] },
  { bearing: 180, letter: COMPASS_POINTS[8] },
  { bearing: 270, letter: COMPASS_POINTS[12] },
] as const;

/* ---------- the rose ---------- */

export const ROSE_SIZE = 190;
export const ROSE_CENTRE = ROSE_SIZE / 2;
export const ROSE_MAX_RADIUS = 70;
/* The favorable ring sits just outside the outer grid circle, inside the
 * cardinal letters. */
export const ROSE_FAVORABLE_RING_RADIUS = 75;
export const ROSE_HUB_RADIUS = 16;
export const ROSE_HUB_DOT_RADIUS = 3;
export const ROSE_LETTER_RADIUS = 82;
export const ROSE_TICK_REACH = 4;
/* Petals cover most of their sector but never touch. */
export const ROSE_PETAL_FILL = 0.82;

export function rosePolar(bearingDeg: number, radius: number): readonly [number, number] {
  const angle = radians(bearingDeg);
  return [ROSE_CENTRE + Math.sin(angle) * radius, ROSE_CENTRE - Math.cos(angle) * radius];
}

const roseAt = ([x, y]: readonly [number, number]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

export function rosePetalPath(bearingDeg: number, radius: number, halfWidthDeg: number): string {
  const outerLeft = rosePolar(bearingDeg - halfWidthDeg, radius);
  const outerRight = rosePolar(bearingDeg + halfWidthDeg, radius);
  const innerLeft = rosePolar(bearingDeg - halfWidthDeg, ROSE_HUB_RADIUS);
  const innerRight = rosePolar(bearingDeg + halfWidthDeg, ROSE_HUB_RADIUS);
  return [
    `M ${roseAt(innerLeft)}`,
    `L ${roseAt(outerLeft)}`,
    `A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${roseAt(outerRight)}`,
    `L ${roseAt(innerRight)}`,
    `A ${ROSE_HUB_RADIUS} ${ROSE_HUB_RADIUS} 0 0 0 ${roseAt(innerLeft)}`,
    "Z",
  ].join(" ");
}

export type FavorableDirection = {
  /* Degrees FROM, like every bearing on the wire. A sector may wrap through
   * north: { fromDeg: 300, toDeg: 40 } covers NW around to NE. */
  fromDeg: number;
  toDeg: number;
};

/* Clockwise arc on the favorable ring from fromDeg to toDeg. The span is the
 * clockwise distance, so wrap-through-north falls out of the modulo; a
 * zero-span sector draws nothing, which is what a zero-width window is. */
export function roseRingArcPath(sector: FavorableDirection): string {
  const from = normalizeDegrees(sector.fromDeg);
  const span = normalizeDegrees(sector.toDeg - sector.fromDeg);
  const start = rosePolar(from, ROSE_FAVORABLE_RING_RADIUS);
  const end = rosePolar(from + span, ROSE_FAVORABLE_RING_RADIUS);
  return `M ${roseAt(start)} A ${ROSE_FAVORABLE_RING_RADIUS} ${ROSE_FAVORABLE_RING_RADIUS} 0 ${
    span > 180 ? 1 : 0
  } 1 ${roseAt(end)}`;
}

export const ROSE_CARDINAL_LETTERS = [
  { bearing: 0, letter: "N" },
  { bearing: 90, letter: "E" },
  { bearing: 180, letter: "S" },
  { bearing: 270, letter: "W" },
] as const;

export const ROSE_INTERCARDINAL_BEARINGS = [45, 135, 225, 315] as const;

/* ---------- the sparkline ---------- */

/* Half the stroke width, so a line riding the scale edge never clips. */
export const SPARKLINE_EDGE_INSET = 1;
/* Headroom over the window maximum, so the trace never kisses the box top. */
export const SPARKLINE_MAX_PADDING = 1.1;

/* Zero to a padded max; a dead-calm window scales against 1 m/s so a flat
 * line sits on the floor rather than dividing by zero. */
export function sparklineScale(
  points: ReadonlyArray<HistoryPoint>,
  width: number,
  height: number,
): { scaleMax: number; xAt(ms: number): number; yAt(speedMps: number): number } {
  const first = points[0];
  const last = points[points.length - 1];
  const startMs = first ? Date.parse(first.observedAt) : 0;
  const durationMs = Math.max(1, (last ? Date.parse(last.observedAt) : startMs) - startMs);
  const top = points.reduce((max, point) => Math.max(max, point.gustMps ?? point.averageMps), 0);
  const scaleMax = top > 0 ? top * SPARKLINE_MAX_PADDING : 1;
  return {
    scaleMax,
    xAt: (ms) =>
      SPARKLINE_EDGE_INSET + ((ms - startMs) / durationMs) * (width - 2 * SPARKLINE_EDGE_INSET),
    yAt: (speedMps) =>
      height -
      SPARKLINE_EDGE_INSET -
      (speedMps / scaleMax) * (height - 2 * SPARKLINE_EDGE_INSET),
  };
}

/* Runs of consecutive samples; a dropout beyond the declared period's
 * tolerance breaks the run, and the line never bridges the silence. Each
 * run is keyed by its first sample's observedAt — a timestamp names a run
 * under a sliding window where an index would churn. */
export type HistoryRun = { startedAt: string; points: HistoryPoint[] };

export function historyRuns(
  points: ReadonlyArray<HistoryPoint>,
  periodMinutes: number,
): HistoryRun[] {
  const gapLimitMs = periodMinutes * 60_000 * HISTORY_GAP_TOLERANCE_FACTOR;
  const runs: HistoryRun[] = [];
  let run: HistoryRun | null = null;
  let previousMs = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const ms = Date.parse(point.observedAt);
    if (run != null && ms - previousMs > gapLimitMs) run = null;
    if (run == null) {
      run = { startedAt: point.observedAt, points: [] };
      runs.push(run);
    }
    run.points.push(point);
    previousMs = ms;
  }
  return runs;
}

/* Band strips: within each run, stretches where the gust–lull pair exists.
 * A null gust or lull ends the strip — a band over guessed extremes is a
 * lie — while the average trace above carries on. */
export function bandStrips(runs: ReadonlyArray<HistoryRun>): HistoryRun[] {
  const strips: HistoryRun[] = [];
  for (const segment of runs) {
    let strip: HistoryRun | null = null;
    for (const point of segment.points) {
      if (point.gustMps == null || point.lullMps == null) {
        strip = null;
        continue;
      }
      if (strip == null) {
        strip = { startedAt: point.observedAt, points: [] };
        strips.push(strip);
      }
      strip.points.push(point);
    }
  }
  return strips;
}
