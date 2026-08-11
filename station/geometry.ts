/* Framework-free chart mathematics over contract history points. Every
 * function returns coordinates, path strings, or indices — never markup —
 * so a React component, a web component, and a server-rendered embed all
 * draw from the same numbers and can never disagree with their tooltips.
 * Speeds are wire-unit m/s throughout; display conversion is the caller's.
 *
 * Charts are drawn at one SVG unit per CSS pixel: a viewBox scaled to fit
 * shrinks its own labels with it. */
import type { History, HistoryPoint } from "./contract.js";
import { CALM_THRESHOLD_MPS, KMH_PER_MPS, degrees, isCalm, normalizeDegrees, radians } from "./derive.js";

export type ChartFrame = {
  height: number;
  labelRow: number;
  left: number;
  plotBottom: number;
  plotTop: number;
  right: number;
  vaneRow: number;
  width: number;
};

export const CHART_FALLBACK_WIDTH = 360;
const CHART_AXIS_GUTTER = 46;
export const VANE_TARGET = 13;

/* Height follows the width the panel actually has, not a media query, so the
 * chart cannot end up tall and narrow inside a mobile tab. */
export function chartFrame(width: number): ChartFrame {
  const plotHeight = width < 520 ? 76 : 116;
  const plotTop = 10;
  const plotBottom = plotTop + plotHeight;
  return {
    height: plotBottom + 64,
    labelRow: plotBottom + 58,
    left: CHART_AXIS_GUTTER,
    plotBottom,
    plotTop,
    right: Math.max(CHART_AXIS_GUTTER + 40, width - 6),
    vaneRow: plotBottom + 26,
    width,
  };
}

export type ChartScales = {
  startMs: number;
  endMs: number;
  durationMs: number;
  /* Rounded up to a niceStepMps boundary, floored at floorMps, so a calm
   * afternoon does not zoom noise into drama. */
  scaleMax: number;
  xAtMs: (ms: number) => number;
  xAt: (observedAt: string) => number;
  yAt: (speedMps: number) => number;
};

export type ChartScaleOptions = {
  /* Axis rounding step in wire m/s. The default is the 5 km/h step the chart
   * has always used, expressed in m/s — display-unit-derived steps arrive in
   * a later wave. */
  niceStepMps?: number;
  /* Minimum scale ceiling in wire m/s (default: 10 km/h in m/s). */
  floorMps?: number;
};

const DEFAULT_NICE_STEP_MPS = 5 / KMH_PER_MPS;
const DEFAULT_FLOOR_MPS = 10 / KMH_PER_MPS;

export function chartScales(
  points: ReadonlyArray<HistoryPoint>,
  frame: ChartFrame,
  options: ChartScaleOptions = {},
): ChartScales {
  const niceStepMps = options.niceStepMps ?? DEFAULT_NICE_STEP_MPS;
  const floorMps = options.floorMps ?? DEFAULT_FLOOR_MPS;
  const first = points[0];
  const startMs = first ? Date.parse(first.observedAt) : 0;
  const last = points[points.length - 1];
  const endMs = last ? Date.parse(last.observedAt) : startMs;
  const durationMs = Math.max(1, endMs - startMs);
  const top = points.reduce(
    (max, point) => Math.max(max, point.gustMps ?? point.averageMps),
    0,
  );
  const scaleMax = Math.max(floorMps, Math.ceil(top / niceStepMps) * niceStepMps);
  const xAtMs = (ms: number) =>
    frame.left + ((ms - startMs) / durationMs) * (frame.right - frame.left);
  return {
    startMs,
    endMs,
    durationMs,
    scaleMax,
    xAtMs,
    xAt: (observedAt) => xAtMs(Date.parse(observedAt)),
    yAt: (speedMps) =>
      frame.plotBottom - (speedMps / scaleMax) * (frame.plotBottom - frame.plotTop),
  };
}

/* A local y-scale for non-speed series (temperature, pressure): the range is
 * padded so a flat afternoon never zooms sensor noise into drama. Null values
 * are skipped — they are the caller's gap-breaking business, not the scale's. */
export function valueScale(
  values: ReadonlyArray<number | null>,
  frame: ChartFrame,
  options: { paddingMin: number },
): { min: number; max: number; yAt(value: number): number } {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value == null) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  /* No carrying value: an arbitrary but finite scale, so a caller that
   * forgot to guard still gets coordinates rather than NaN. */
  if (low > high) {
    low = 0;
    high = 0;
  }
  const min = low - options.paddingMin;
  const max = high + options.paddingMin;
  return {
    min,
    max,
    yAt: (value) =>
      frame.plotBottom - ((value - min) / (max - min)) * (frame.plotBottom - frame.plotTop),
  };
}

const coordinate = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

/* The lull-to-gust band. Null when any point lacks the pair — a band drawn
 * over guessed lulls is a lie, and the capability flag should have said so. */
export function bandPoints(
  points: ReadonlyArray<HistoryPoint>,
  scales: ChartScales,
): string | null {
  if (points.length === 0) return null;
  if (points.some((point) => point.gustMps == null || point.lullMps == null)) return null;
  const gust = points.map((point) =>
    coordinate(scales.xAt(point.observedAt), scales.yAt(point.gustMps as number)),
  );
  const lull = [...points]
    .reverse()
    .map((point) =>
      coordinate(scales.xAt(point.observedAt), scales.yAt(point.lullMps as number)),
    );
  return [...gust, ...lull].join(" ");
}

export function averagePoints(
  points: ReadonlyArray<HistoryPoint>,
  scales: ChartScales,
): string {
  return points
    .map((point) => coordinate(scales.xAt(point.observedAt), scales.yAt(point.averageMps)))
    .join(" ");
}

/* Vector mean, so averaging never walks through south to get from 350° to
 * 10°. Calm samples carry no direction and are excluded; null when every
 * sample was calm. */
export function meanDirectionDeg(points: ReadonlyArray<HistoryPoint>): number | null {
  const blowing = points.filter(
    (point) => !isCalm(point.averageMps) && point.directionDeg != null,
  );
  if (blowing.length === 0) return null;
  const vector = blowing.reduce(
    (total, point) => {
      const angle = radians(point.directionDeg as number);
      return { cos: total.cos + Math.cos(angle), sin: total.sin + Math.sin(angle) };
    },
    { cos: 0, sin: 0 },
  );
  return normalizeDegrees(degrees(Math.atan2(vector.sin, vector.cos)));
}

/* True vector mean over a point window: each sample's (speed, direction) is
 * decomposed into components, averaged, and the average vector is reported
 * back as (magnitude, direction) — the "vector-averaged" wind a long-window
 * summary (a daily pattern, a season) wants, as distinct from the scalar
 * mean speed averagePoints plots. A calm sample (no direction) contributes a
 * zero vector: it pulls the resultant magnitude down exactly as a real
 * windless moment should, with no direction needed to do trigonometry with.
 * Empty input reports zero speed and no direction. */
export type WindVector = { directionDeg: number | null; speedMps: number };

export function vectorMeanWind(points: ReadonlyArray<HistoryPoint>): WindVector {
  if (points.length === 0) return { directionDeg: null, speedMps: 0 };
  let u = 0;
  let v = 0;
  for (const point of points) {
    if (point.directionDeg == null) continue;
    const angle = radians(point.directionDeg);
    u += point.averageMps * Math.sin(angle);
    v += point.averageMps * Math.cos(angle);
  }
  u /= points.length;
  v /= points.length;
  const speedMps = Math.hypot(u, v);
  return {
    directionDeg: speedMps < CALM_THRESHOLD_MPS ? null : normalizeDegrees(degrees(Math.atan2(u, v))),
    speedMps,
  };
}

export type Vane = { directionDeg: number | null; midMs: number };

/* Thinned so vanes cannot touch. Each is the vector mean of its window, not
 * one sample plucked from it, so a vane never claims a direction the wind
 * only held for five minutes. */
export function thinVanes(
  points: ReadonlyArray<HistoryPoint>,
  target: number = VANE_TARGET,
): Vane[] {
  if (points.length === 0) return [];
  const step = Math.max(1, Math.round(points.length / target));
  return Array.from({ length: Math.ceil(points.length / step) }, (_, index) => {
    const window = points.slice(index * step, index * step + step);
    const first = Date.parse((window[0] as HistoryPoint).observedAt);
    const last = Date.parse((window[window.length - 1] as HistoryPoint).observedAt);
    return { directionDeg: meanDirectionDeg(window), midMs: first + (last - first) / 2 };
  });
}

/* Points where the wind is blowing TO — the flow convention. `bearingDeg` is
 * the FROM bearing the feed reports. */
export function vanePath(
  cx: number,
  cy: number,
  bearingDeg: number,
  { reach = 7, spread = 3.2 }: { reach?: number; spread?: number } = {},
): string {
  const angle = radians(bearingDeg + 180);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const tip = [cx + sin * reach, cy - cos * reach] as const;
  const tail = [cx - sin * reach, cy + cos * reach] as const;
  const left = [
    tip[0] - sin * spread + cos * spread,
    tip[1] + cos * spread + sin * spread,
  ] as const;
  const right = [
    tip[0] - sin * spread - cos * spread,
    tip[1] + cos * spread - sin * spread,
  ] as const;
  const at = ([px, py]: readonly [number, number]) => `${px.toFixed(1)} ${py.toFixed(1)}`;
  return `M ${at(tail)} L ${at(tip)} M ${at(left)} L ${at(tip)} L ${at(right)}`;
}

export type ChartTick = { index: number; timeMs: number; x: number };

/* Tick times are read off the vanes, so a labelled time sits under an actual
 * vane instead of between two of them. */
export function vaneTicks(vanes: ReadonlyArray<Vane>, scales: ChartScales): ChartTick[] {
  if (vanes.length === 0) return [];
  return [0, 0.25, 0.5, 0.75, 1].map((fraction, index) => {
    const vane = vanes[Math.round(fraction * (vanes.length - 1))] as Vane;
    return { index, timeMs: vane.midMs, x: scales.xAtMs(vane.midMs) };
  });
}

/* Hit-testing: chart-space x → the index of the nearest sample. The caller
 * converts a client pixel to chart space with its own bounding box. */
export function nearestIndex(
  points: ReadonlyArray<HistoryPoint>,
  chartX: number,
  frame: ChartFrame,
  scales: ChartScales,
): number | null {
  if (points.length === 0) return null;
  const ms =
    scales.startMs +
    ((chartX - frame.left) / (frame.right - frame.left)) * scales.durationMs;
  return points.reduce(
    (nearest, point, index) =>
      Math.abs(Date.parse(point.observedAt) - ms) <
      Math.abs(Date.parse((points[nearest] as HistoryPoint).observedAt) - ms)
        ? index
        : nearest,
    0,
  );
}

export function isCalmHistory(points: ReadonlyArray<HistoryPoint>): boolean {
  return points.every((point) => isCalm(point.gustMps ?? point.averageMps));
}

/* Speed banding against consumer thresholds — the axis of control an iframe
 * never offered. Thresholds are ascending wire-unit m/s bounds; the return is
 * which band a speed falls in (0..thresholds.length). What a band means —
 * flyable, marginal, nuked — and what colour it wears belong to the consumer. */
export function speedBand(speedMps: number, thresholdsMps: ReadonlyArray<number>): number {
  let band = 0;
  for (const bound of thresholdsMps) {
    if (speedMps < bound) return band;
    band += 1;
  }
  return band;
}

export type RoseSector = {
  /* Sector centre bearing, degrees FROM. */
  bearingDeg: number;
  /* Share of non-calm samples in this sector, 0..1. */
  frequency: number;
  meanSpeedMps: number | null;
  maxGustMps: number | null;
  count: number;
};

export type WindRoseSummary = {
  sectors: RoseSector[];
  calmFraction: number;
  sampleCount: number;
};

/* Direction distribution over the window — sequence is the vane row's job;
 * concentration is the rose's. Calm samples are counted apart rather than
 * smeared into a sector. */
export function windRose(
  points: ReadonlyArray<HistoryPoint>,
  sectorCount = 16,
): WindRoseSummary {
  const sectorWidth = 360 / sectorCount;
  const sectors = Array.from({ length: sectorCount }, (_, index) => ({
    bearingDeg: index * sectorWidth,
    speeds: [] as number[],
    gusts: [] as number[],
  }));
  let calm = 0;
  let counted = 0;
  for (const point of points) {
    counted += 1;
    if (isCalm(point.averageMps) || point.directionDeg == null) {
      calm += 1;
      continue;
    }
    const index =
      Math.round(normalizeDegrees(point.directionDeg) / sectorWidth) % sectorCount;
    const sector = sectors[index] as (typeof sectors)[number];
    sector.speeds.push(point.averageMps);
    if (point.gustMps != null) sector.gusts.push(point.gustMps);
  }
  const blowing = counted - calm;
  return {
    sampleCount: counted,
    calmFraction: counted === 0 ? 0 : calm / counted,
    sectors: sectors.map((sector) => ({
      bearingDeg: sector.bearingDeg,
      count: sector.speeds.length,
      frequency: blowing === 0 ? 0 : sector.speeds.length / blowing,
      meanSpeedMps:
        sector.speeds.length === 0
          ? null
          : sector.speeds.reduce((sum, speed) => sum + speed, 0) / sector.speeds.length,
      maxGustMps: sector.gusts.length === 0 ? null : Math.max(...sector.gusts),
    })),
  };
}

export const DAILY_PATTERN_DEFAULT_SLOT_MINUTES = 180;

export type DailyPatternSlot = {
  /* Minutes since local midnight this slot begins at (0, slotMinutes,
   * 2×slotMinutes, …) — a bucket boundary, not a sample's own timestamp. */
  startMinuteOfDay: number;
  sampleCount: number;
  directionDeg: number | null;
  speedMps: number;
};

/* A typical day: every point is dropped into a fixed-width slot by its
 * time-of-day alone (the calendar date is discarded), and each slot reports
 * the vector-mean wind of everything that ever fell into it — the same shape
 * as a season's "daily pattern" chart, built from raw history rather than
 * trusting an upstream's own pre-aggregation.
 *
 * "Local" here is a plain UTC offset, not an IANA zone: matching the
 * "local standard time (no DST)" a station page itself commits to, and
 * keeping this module free of Intl / zoneinfo. A consumer wanting real
 * zone+DST behaviour resolves its own offset (e.g. via the station's
 * declared IANA zone) and passes the minutes across; the default of 0
 * buckets in UTC. */
export function dailyPattern(
  points: ReadonlyArray<HistoryPoint>,
  options: { slotMinutes?: number; utcOffsetMinutes?: number } = {},
): DailyPatternSlot[] {
  const slotMinutes = options.slotMinutes ?? DAILY_PATTERN_DEFAULT_SLOT_MINUTES;
  if (slotMinutes <= 0 || 1440 % slotMinutes !== 0) {
    throw new Error(`dailyPattern: slotMinutes must evenly divide 1440, got ${slotMinutes}`);
  }
  const utcOffsetMinutes = options.utcOffsetMinutes ?? 0;
  const slotCount = 1440 / slotMinutes;
  const buckets: HistoryPoint[][] = Array.from({ length: slotCount }, () => []);
  for (const point of points) {
    const minuteOfDay = floorMod(
      Math.floor(Date.parse(point.observedAt) / 60_000) + utcOffsetMinutes,
      1440,
    );
    (buckets[Math.floor(minuteOfDay / slotMinutes)] as HistoryPoint[]).push(point);
  }
  return buckets.map((bucket, index) => ({
    startMinuteOfDay: index * slotMinutes,
    sampleCount: bucket.length,
    ...vectorMeanWind(bucket),
  }));
}

function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/* Meteorological seasons: fixed three-month groups (DJF/MAM/JJA/SON),
 * Northern-hemisphere-named — a Southern-hemisphere consumer swaps the
 * label it shows, not the months a season actually spans. */
export const METEOROLOGICAL_SEASON_MONTHS: Record<"fall" | "spring" | "summer" | "winter", number[]> = {
  winter: [12, 1, 2],
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  fall: [9, 10, 11],
};

/* filterByMonth/filterByTimeOfDay: the two axes WindRose's own consumers
 * keep reaching for (a season picker, a time-of-day picker) — narrowing
 * WHICH history points feed the rose or the chart, never how those points
 * are drawn. Composable rather than a combined "window" object: a season
 * rose, a time-of-day rose, and a season-AND-time-of-day rose are all just
 * one or two calls piped together.
 *
 * "Local" is a plain UTC offset, not an IANA zone — dailyPattern's same
 * choice, for the same reason (no Intl/zoneinfo in this module, and it
 * matches the "local standard time (no DST)" a station page itself
 * commits to). */

export function filterByMonth(
  points: ReadonlyArray<HistoryPoint>,
  months: ReadonlyArray<number>,
  utcOffsetMinutes = 0,
): HistoryPoint[] {
  const wanted = new Set(months);
  return points.filter((point) => wanted.has(localMonth(point.observedAt, utcOffsetMinutes)));
}

function localMonth(observedAt: string, utcOffsetMinutes: number): number {
  return new Date(Date.parse(observedAt) + utcOffsetMinutes * 60_000).getUTCMonth() + 1;
}

/* [fromMinute, toMinute) of the day, in local minutes; fromMinute > toMinute
 * wraps past midnight (a "night" window, say 21:00–06:00), the same
 * half-open convention dailyPattern's own slots use. */
export function filterByTimeOfDay(
  points: ReadonlyArray<HistoryPoint>,
  fromMinute: number,
  toMinute: number,
  utcOffsetMinutes = 0,
): HistoryPoint[] {
  const wraps = fromMinute > toMinute;
  return points.filter((point) => {
    const minute = floorMod(
      Math.floor(Date.parse(point.observedAt) / 60_000) + utcOffsetMinutes,
      1440,
    );
    return wraps ? minute >= fromMinute || minute < toMinute : minute >= fromMinute && minute < toMinute;
  });
}

/* Silence beyond this many declared periods is an outage, not a long
 * sample — the one dropout tolerance the chart, the sparkline, and the
 * trend all judge with. */
export const HISTORY_GAP_TOLERANCE_FACTOR = 2.5;

/* Dropout detection: a vendor expresses an outage as an absent record, never
 * a zeroed one, so gaps are found by comparing neighbours against the
 * declared period. Returns [startMs, endMs] pairs of silent spans. */
export function historyGaps(
  history: History,
  toleranceFactor = HISTORY_GAP_TOLERANCE_FACTOR,
): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  const limit = history.periodMinutes * 60_000 * toleranceFactor;
  for (let index = 1; index < history.points.length; index += 1) {
    const previous = Date.parse((history.points[index - 1] as HistoryPoint).observedAt);
    const current = Date.parse((history.points[index] as HistoryPoint).observedAt);
    if (current - previous > limit) gaps.push([previous, current]);
  }
  return gaps;
}

/* Wide plots earn more vertical room than the core default; narrow ones keep
 * the core's phone-sized frame. */
export const CHART_WIDE_PLOT_HEIGHT = 160;
export const CHART_WIDE_PLOT_MIN_WIDTH = 520;

/* Stretch the core frame's plot without re-deriving its row math: every row
 * below the plot shifts by the same delta. */
export function stretchFrame(frame: ChartFrame, plotHeight: number): ChartFrame {
  const delta = plotHeight - (frame.plotBottom - frame.plotTop);
  if (delta === 0) return frame;
  return {
    ...frame,
    height: frame.height + delta,
    labelRow: frame.labelRow + delta,
    plotBottom: frame.plotBottom + delta,
    vaneRow: frame.vaneRow + delta,
  };
}

/* ---------- the trend series ---------- */

export type TrendSeries = "temperature" | "pressure";

export function trendValueOf(point: HistoryPoint, series: TrendSeries): number | null {
  return series === "temperature" ? point.temperatureC : (point.seaLevelPressureHpa ?? null);
}

/* Units are fixed per series — °C and hPa — which is why trend components
 * take no speed `unit` prop at all. The padding keeps a flat afternoon from
 * zooming sensor noise into drama. */
export function trendSeriesPad(series: TrendSeries): number {
  return series === "temperature" ? 1 : 2;
}

/* Runs of consecutive carrying samples as [ms, value] pairs; a null value or
 * a dropout beyond the declared period's tolerance breaks the run, and the
 * trace is never interpolated across either. A one-sample run is still a
 * measurement (drawn as a dot). Each run remembers its first sample's
 * observedAt: a timestamp names a run under a sliding window, where an index
 * would churn. */
export type TrendRun = { startedAt: string; samples: Array<readonly [number, number]> };

export function trendRuns(
  points: ReadonlyArray<HistoryPoint>,
  series: TrendSeries,
  periodMinutes: number,
): TrendRun[] {
  const gapLimitMs = periodMinutes * 60_000 * HISTORY_GAP_TOLERANCE_FACTOR;
  const runs: TrendRun[] = [];
  let run: TrendRun | null = null;
  let previousMs = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const value = trendValueOf(point, series);
    const ms = Date.parse(point.observedAt);
    if ((value == null || ms - previousMs > gapLimitMs) && run != null) {
      runs.push(run);
      run = null;
    }
    if (value != null) {
      run ??= { startedAt: point.observedAt, samples: [] };
      run.samples.push([ms, value] as const);
    }
    previousMs = ms;
  }
  if (run != null) runs.push(run);
  return runs;
}
