/* Pure derivations over contract documents: angles, compass words, unit
 * conversion, period statistics, and freshness. Isomorphic; no I/O. */
import type { History, HistoryPoint, StationMeta } from "./contract.js";
import { KMH_PER_MPS } from "../core/units.js";

/* Defined once in core/units (the adapters' conversion helpers live there);
 * re-exported here for display math (axis steps, thresholds authored in
 * km/h). */
export { KMH_PER_MPS };

/* WMO/METAR calm: under 0.5 m/s the wind has no reportable direction. Exact
 * zero is the wrong test on both instrument families — a sonic head in dead
 * air drifts at 0.03–0.11 m/s and would wear a confident arrow, while a cup
 * anemometer's vane parks below ~1.1 m/s and would report its resting
 * bearing. The measured speed still travels; only direction is withheld. */
export const CALM_THRESHOLD_MPS = 0.5;

export function isCalm(speedMps: number): boolean {
  return speedMps < CALM_THRESHOLD_MPS;
}

/* The wire speaks m/s only; display units are a client conversion. Sailors
 * read knots, US pilots mph, most of the world km/h — the number converts,
 * the document never does. */
export const SPEED_UNITS = ["kmh", "knots", "mph", "mps"] as const;
export type SpeedUnit = (typeof SPEED_UNITS)[number];

/* Display units per m/s. Knots and mph via their exact SI definitions
 * (1 kn = 0.514444 m/s, 1 mph = 0.44704 m/s). */
const KNOTS_PER_MPS = 1 / 0.514444;
const MPH_PER_MPS = 1 / 0.44704;

function unitsPerMps(unit: SpeedUnit): number {
  switch (unit) {
    case "kmh":
      return KMH_PER_MPS;
    case "knots":
      return KNOTS_PER_MPS;
    case "mph":
      return MPH_PER_MPS;
    case "mps":
      return 1;
  }
}

/* Wire → display. */
export function speedFromMps(mps: number, unit: SpeedUnit): number {
  return mps * unitsPerMps(unit);
}

/* Vendor/display → wire. Adapters call this at Reading/HistoryPoint
 * construction, after validating in the vendor's own units. */
export function speedToMps(value: number, unit: SpeedUnit): number {
  return value / unitsPerMps(unit);
}

/* Consumer-vocabulary speed thresholds. The wire and every derivation speak
 * m/s, but a club thinks in its own unit — "12, 20, 28 km/h" — so thresholds
 * carry their unit explicitly and convert to wire m/s at exactly one place,
 * `thresholdsToMps`, before any speedBand call. Renderers label threshold
 * guides with the numbers the consumer declared (converted only when the
 * display unit differs), never with round-tripped wire values. */
export type SpeedThresholds = {
  /* The unit `values` are authored in — the consumer's vocabulary. */
  unit: SpeedUnit;
  /* Ascending bounds in that unit; speedBand grades into 0..values.length. */
  values: readonly number[];
};

/* The ONE consumer-unit → wire conversion point. Everything downstream
 * (speedBand, zone cuts, guide positions) receives wire m/s. */
export function thresholdsToMps(thresholds: SpeedThresholds): number[] {
  return thresholds.values.map((value) => speedToMps(value, thresholds.unit));
}

export function speedUnitLabel(unit: SpeedUnit): string {
  switch (unit) {
    case "kmh":
      return "km/h";
    case "knots":
      return "kn";
    case "mph":
      return "mph";
    case "mps":
      return "m/s";
  }
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function degrees(radianValue: number): number {
  return (radianValue * 180) / Math.PI;
}

export const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/* English compass words are a derivation, not wire data — an i18n layer
 * substitutes its own sixteen words and this stays out of its way. */
export function compassDirection(bearingDeg: number): CompassPoint {
  const normalized = normalizeDegrees(bearingDeg);
  return COMPASS_POINTS[Math.round(normalized / 22.5) % COMPASS_POINTS.length] as CompassPoint;
}

export type PeriodSummary = {
  averageMps: number;
  /* The extremes come from the gust/lull series — name them so. */
  peakGustMps: number | null;
  peakGustAt: string | null;
  lowestLullMps: number | null;
  periodEndedAt: string;
  temperatureHighC: number | null;
  temperatureHighAt: string | null;
  temperatureLowC: number | null;
  temperatureLowAt: string | null;
  /* Distance the air travelled: each record's average held for the period it
   * covers. Functions of periodMinutes are why cadence rides the wire. */
  windRunKm: number;
};

/* Summarised from the same records a chart draws, so every stat under the
 * chart shares the chart's window. Peak and lowest come from the gust/lull
 * series and stay null when the station does not measure them. */
export function periodSummary(history: History): PeriodSummary | null {
  const points = history.points;
  const last = points[points.length - 1];
  if (!last) return null;
  const speedSum = points.reduce((total, point) => total + point.averageMps, 0);

  let peak: HistoryPoint | null = null;
  let lowestLullMps: number | null = null;
  let high: HistoryPoint | null = null;
  let low: HistoryPoint | null = null;
  for (const point of points) {
    if (point.gustMps != null && (peak == null || point.gustMps > (peak.gustMps as number))) {
      peak = point;
    }
    if (point.lullMps != null) {
      lowestLullMps = lowestLullMps == null ? point.lullMps : Math.min(lowestLullMps, point.lullMps);
    }
    if (point.temperatureC != null) {
      if (high == null || point.temperatureC > (high.temperatureC as number)) high = point;
      if (low == null || point.temperatureC < (low.temperatureC as number)) low = point;
    }
  }

  return {
    averageMps: speedSum / points.length,
    peakGustMps: peak?.gustMps ?? null,
    peakGustAt: peak?.observedAt ?? null,
    lowestLullMps,
    periodEndedAt: last.observedAt,
    temperatureHighC: high?.temperatureC ?? null,
    temperatureHighAt: high?.observedAt ?? null,
    temperatureLowC: low?.temperatureC ?? null,
    temperatureLowAt: low?.observedAt ?? null,
    /* Sum of averageMps × the seconds each record covers, ÷ 1000 → km. */
    windRunKm: (speedSum * history.periodMinutes * 60) / 1000,
  };
}

/* Reduce station pressure to sea level (the QFF-style approximation with the
 * standard 6.5 K/km lapse). A station's raw barometer at elevation is not
 * comparable to anything; corrected, it lines up with neighbouring stations
 * and forecasts. Temperature defaults to the ISA 15 °C when the station does
 * not measure it. elevationM is the SENSOR's elevation — a launch's number
 * only when the hardware actually stands on the launch. */
export function seaLevelPressureHpa(
  stationPressureHpa: number,
  elevationM: number,
  temperatureC: number | null = 15,
): number {
  const temperature = temperatureC ?? 15;
  const factor = 1 - (0.0065 * elevationM) / (temperature + 0.0065 * elevationM + 273.15);
  return stationPressureHpa * Math.pow(factor, -5.257);
}

export type PressureTendency = "falling" | "rising" | "steady";

/* Three-hour tendency, the synoptic convention: compare now against the
 * sample nearest windowHours ago. Null when the series does not reach far
 * enough back to say. Threshold 1.5 hPa/3 h — a sharper move than diurnal
 * breathing, gentler than requiring a front. */
export function pressureTendency(
  points: ReadonlyArray<{ observedAt: string; seaLevelPressureHpa?: number | null }>,
  { windowHours = 3, thresholdHpa = 1.5 }: { windowHours?: number; thresholdHpa?: number } = {},
): PressureTendency | null {
  const carrying = points.filter((point) => point.seaLevelPressureHpa != null);
  const last = carrying[carrying.length - 1];
  if (!last) return null;
  const targetMs = Date.parse(last.observedAt) - windowHours * 3_600_000;
  let reference: (typeof carrying)[number] | null = null;
  for (const point of carrying) {
    if (
      reference == null ||
      Math.abs(Date.parse(point.observedAt) - targetMs) <
        Math.abs(Date.parse(reference.observedAt) - targetMs)
    ) {
      reference = point;
    }
  }
  if (
    reference == null ||
    Date.parse(last.observedAt) - Date.parse(reference.observedAt) < windowHours * 3_600_000 * 0.6
  ) {
    return null;
  }
  const delta = (last.seaLevelPressureHpa as number) - (reference.seaLevelPressureHpa as number);
  if (delta >= thresholdHpa) return "rising";
  if (delta <= -thresholdHpa) return "falling";
  return "steady";
}

/* "live", not "current": the /current endpoint already owns that word. */
export type FreshnessStatus = "live" | "aging" | "stale";

export type FreshnessThresholds = {
  currentForMs: number;
  staleAfterMs: number;
};

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  currentForMs: 10 * 60_000,
  staleAfterMs: 45 * 60_000,
};

const clampMs = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/* Freshness scaled to the station's own cadence: ten minutes of silence is
 * routine for a five-minute logger and a dead feed for a three-second one.
 * The flat DEFAULT_FRESHNESS_THRESHOLDS pair remains the meta-less fallback. */
export function stationFreshnessThresholds(
  meta: Pick<StationMeta, "recommendedPollSeconds">,
): FreshnessThresholds {
  const currentForMs = clampMs(meta.recommendedPollSeconds * 5 * 1_000, 60_000, 10 * 60_000);
  return {
    currentForMs,
    staleAfterMs: clampMs(currentForMs * 6, 10 * 60_000, 45 * 60_000),
  };
}

/* Freshness is judged on the client, but against the server's clock: the
 * observation's age at serve time plus how long ago this client received the
 * response. servedAt anchors the calculation so a wrong client clock cannot
 * declare a live station stale (or a dead one live). */
export function freshness(
  input: {
    observedAt: string;
    servedAt: string;
    receivedAtMs: number;
    nowMs: number;
  },
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS_THRESHOLDS,
): FreshnessStatus {
  const ageAtServeMs = Date.parse(input.servedAt) - Date.parse(input.observedAt);
  const sinceReceivedMs = Math.max(0, input.nowMs - input.receivedAtMs);
  const ageMs = Math.max(0, ageAtServeMs) + sinceReceivedMs;
  if (ageMs <= thresholds.currentForMs) return "live";
  if (ageMs <= thresholds.staleAfterMs) return "aging";
  return "stale";
}
