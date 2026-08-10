/* How a fragment of a reading prints — the rounding, dashing, calm-vs-dash,
 * age-wording, and summary-line rules shared by every binding. Functions here
 * return strings and plain data, never markup, so a React component, a custom
 * element, and a server-rendered embed print the same characters for the same
 * reading and can never disagree.
 *
 * The shared discipline the rules encode:
 * - A value the station did not report is an em dash IN PLACE, never an
 *   absent cell — readings are replaced on every poll and geometry keyed to
 *   which values came back non-null would twitch on every tick.
 * - Calm (WMO: below 0.5 m/s) is not a missing value: it is said in the calm
 *   word; the dash on a direction is reserved for a dead vane on a blowing
 *   reading.
 * - Display rounding converts to the display unit; the wire (and every
 *   geometry decision) stays m/s. */
import type { Station } from "./contract.js";
import { compassDirection, isCalm, periodSummary, speedFromMps } from "./derive.js";
import type { CompassPoint, SpeedUnit } from "./derive.js";
import { EM_DASH } from "./strings.js";
import type { FormatTime, StationStrings } from "./strings.js";

/* Display rounding: shown speeds convert to the display unit; the wire (and
 * every geometry decision) stays m/s. */
export function roundSpeed(mps: number, unit: SpeedUnit): number {
  return Math.round(speedFromMps(mps, unit));
}

/* A value the station did not report is an em dash IN PLACE, never an absent
 * cell. */
export function optionalSpeed(mps: number | null, unit: SpeedUnit): string {
  return mps == null ? EM_DASH : String(roundSpeed(mps, unit));
}

/* The ONE temperature precision rule: one decimal, everywhere a °C prints. */
export function temperatureValue(temperatureC: number): string {
  return temperatureC.toFixed(1);
}

export function temperatureText(temperatureC: number | null, words: StationStrings): string {
  return temperatureC == null ? EM_DASH : `${temperatureValue(temperatureC)} ${words.degC}`;
}

/* ---------- speeds off a station ---------- */

export type SpeedKind = "average" | "gust" | "lull";

/* Capability-false and null both dash: the capability gate keeps a station
 * that never measures gusts honest even if a lying value slipped through. */
export function speedMpsOf(station: Station, kind: SpeedKind): number | null {
  if (station.status !== "ok") return null;
  switch (kind) {
    case "average":
      return station.reading.averageMps;
    case "gust":
      return station.capabilities.gustLull ? station.reading.gustMps : null;
    case "lull":
      return station.capabilities.gustLull ? station.reading.lullMps : null;
  }
}

/* ---------- direction ---------- */

/* Calm (WMO: below 0.5 m/s) withholds direction, said in a word; a null
 * bearing on a blowing reading is a broken vane and earns the dash. Data,
 * not markup: each binding draws its own arrow glyph beside the words. */
export type DirectionCellData =
  | { kind: "calm" }
  | { kind: "dash" }
  | { kind: "bearing"; deg: number; compass: CompassPoint; rounded: number };

export function directionCell(averageMps: number, directionDeg: number | null): DirectionCellData {
  if (isCalm(averageMps)) return { kind: "calm" };
  if (directionDeg == null) return { kind: "dash" };
  return {
    kind: "bearing",
    deg: directionDeg,
    compass: compassDirection(directionDeg),
    rounded: Math.round(directionDeg),
  };
}

/* ---------- reading age ---------- */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/* Past ~6 hours "n hr ago" reads as noise; the absolute time says more. */
export const UPDATED_ABSOLUTE_AFTER_MS = 6 * HOUR_MS;

/* The relative-time vocabulary rides the strings module's `updated` group,
 * i18n-able like every other word. */
export function relativeWords(ageMs: number, words: StationStrings): string {
  if (ageMs < MINUTE_MS) return words.updated.justNow;
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 60) return words.updated.minutesAgo(minutes);
  return words.updated.hoursAgo(Math.floor(ageMs / HOUR_MS));
}

/* Server-anchored when the anchor exists — age at serve plus time since
 * receipt, so a wrong client clock cannot lie — and the client clock
 * otherwise. */
export function readingAgeMs(args: {
  observedAt: string;
  servedAt: string | null;
  receivedAtMs: number | null;
  nowMs: number;
}): number {
  const observedMs = Date.parse(args.observedAt);
  return args.servedAt != null && args.receivedAtMs != null
    ? Math.max(0, Date.parse(args.servedAt) - observedMs) +
        Math.max(0, args.nowMs - args.receivedAtMs)
    : Math.max(0, args.nowMs - observedMs);
}

/* The UpdatedAt sentence: ticking relative age until ~6 hours, the absolute
 * formatTime words beyond. */
export function updatedAtText(
  ageMs: number,
  observedAt: string,
  words: StationStrings,
  formatTime: FormatTime,
): string {
  return ageMs >= UPDATED_ABSOLUTE_AFTER_MS
    ? formatTime(new Date(Date.parse(observedAt)))
    : relativeWords(ageMs, words);
}

/* ---------- the period summary strip ---------- */

/* Stats the instrument cannot measure are dropped rather than dashed: the
 * strip reads as a complete footnote, and a permanent hole says nothing. A
 * value the instrument measures but missed stays an em dash in place. */
export type SummaryEntry = { label: string; value: string };

export function summaryEntries(
  station: Station,
  unit: SpeedUnit,
  words: StationStrings,
  formatTime: FormatTime,
): { entries: SummaryEntry[]; periodEndedAt: string } | null {
  const history = station.status === "ok" ? station.history : null;
  const summary = history == null || history.points.length === 0 ? null : periodSummary(history);
  if (summary == null) return null;

  const capabilities = station.capabilities;
  const shown = (averageMps: number) => roundSpeed(averageMps, unit);
  const unitLabel = words.speedUnits[unit];
  const entries: SummaryEntry[] = [
    { label: words.averageLabel, value: `${shown(summary.averageMps)} ${unitLabel}` },
    ...(capabilities.gustLull
      ? [
          {
            label: words.peakLabel,
            value:
              summary.peakGustMps == null
                ? EM_DASH
                : `${shown(summary.peakGustMps)} ${unitLabel}${
                    summary.peakGustAt == null
                      ? ""
                      : ` · ${formatTime(new Date(summary.peakGustAt))}`
                  }`,
          },
          {
            label: words.minLabel,
            value:
              summary.lowestLullMps == null
                ? EM_DASH
                : `${shown(summary.lowestLullMps)} ${unitLabel}`,
          },
        ]
      : []),
    { label: words.windRunLabel, value: `${Math.round(summary.windRunKm)} ${words.km}` },
    ...(capabilities.temperature
      ? [
          {
            label: words.tempRangeLabel,
            value:
              summary.temperatureLowC == null || summary.temperatureHighC == null
                ? EM_DASH
                : `${summary.temperatureLowC.toFixed(1)}–${summary.temperatureHighC.toFixed(1)} ${words.degC}`,
          },
        ]
      : []),
  ];

  return { entries, periodEndedAt: summary.periodEndedAt };
}
