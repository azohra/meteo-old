"use client";
/* TEXT ATOMS: the smallest reading fragments as standalone inline elements —
 * a speed, a temperature, a bearing, a ticking "3 min ago", a graded band
 * chip — for consumers composing their own layouts out of package-consistent
 * pieces.
 *
 * Shared discipline, inherited from the bigger components:
 * - Fixed geometry: a value the station cannot report right now is an em dash
 *   IN PLACE, inside the same element, never an absent node — readings are
 *   replaced on every poll and geometry keyed to which values came back
 *   non-null would twitch on every tick. A lacking capability and an
 *   unavailable station earn the same dash. Calm is not a missing value: it
 *   is said in the calm word (the library-wide convention); the dash on a
 *   direction is reserved for a dead vane on a blowing reading.
 * - Provider-resolvable: explicit `station` wins, then `stationId` looked up
 *   in the ambient feed, then primaryStationId, then stations[0]; resolving
 *   nothing throws the wiring error. Every atom still works with zero
 *   provider via explicit props.
 * - Display unit is a client conversion (integer rounding, like the dial and
 *   the compare table); the wire value rides the <data> element's `value`
 *   attribute in m/s so the machine-readable number never rounds.
 * - No layout opinions: everything renders inline. */
import { useEffect, useState } from "react";
import { compassDirection, isCalm, speedBand } from "../../index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { DirectionCell, roundSpeed, temperatureValue } from "../lib/cells.js";
import {
  EM_DASH,
  defaultFormatTime,
  mergeStringOverrides,
  resolveStrings,
} from "../lib/strings.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../lib/strings.js";
import { thresholdsToMps } from "../lib/thresholds.js";
import type { SpeedThresholds } from "../lib/thresholds.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";
import type { StationFeedContextValue } from "./StationFeedProvider.js";

type AtomProps = {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  strings?: StationStringOverrides;
};

type SpeedAtomProps = AtomProps & {
  /* Display unit only: the shown number converts, the wire stays m/s. */
  unit?: SpeedUnit;
};

function useResolvedStation(
  component: string,
  stationProp: Station | undefined,
  stationId: string | undefined,
): { context: StationFeedContextValue | null; station: Station } {
  const context = useStationFeedContext();
  const station = requireResolved(
    component,
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  return { context, station };
}

/* ---------- speeds ---------- */

type SpeedKind = "average" | "gust" | "lull";

/* Capability-false and null both dash: the capability gate keeps a station
 * that never measures gusts honest even if a lying value slipped through. */
function speedMpsOf(station: Station, kind: SpeedKind): number | null {
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

function SpeedValue({
  component,
  kind,
  station: stationProp,
  stationId,
  unit: unitProp,
  strings: stringsProp,
}: SpeedAtomProps & { component: string; kind: SpeedKind }) {
  const { context, station } = useResolvedStation(component, stationProp, stationId);
  const unit = unitProp ?? context?.unit ?? "kmh";
  const words = resolveStrings(mergeStringOverrides(context?.strings, stringsProp));
  const mps = speedMpsOf(station, kind);
  return (
    <data className="meteo-value meteo-speed" value={mps ?? undefined}>
      {mps == null ? (
        EM_DASH
      ) : (
        <>
          {roundSpeed(mps, unit)} <span className="meteo-unit">{words.speedUnits[unit]}</span>
        </>
      )}
    </data>
  );
}

export function Speed(props: SpeedAtomProps) {
  return <SpeedValue component="Speed" kind="average" {...props} />;
}

export function Gust(props: SpeedAtomProps) {
  return <SpeedValue component="Gust" kind="gust" {...props} />;
}

export function Lull(props: SpeedAtomProps) {
  return <SpeedValue component="Lull" kind="lull" {...props} />;
}

/* ---------- temperature and pressure ---------- */

/* One decimal with the degree word, the compare table's format exactly. */
export function Temperature({ station: stationProp, stationId, strings: stringsProp }: AtomProps) {
  const { context, station } = useResolvedStation("Temperature", stationProp, stationId);
  const words = resolveStrings(mergeStringOverrides(context?.strings, stringsProp));
  const celsius =
    station.status === "ok" && station.capabilities.temperature
      ? station.reading.temperatureC
      : null;
  return (
    <data className="meteo-value meteo-temperature" value={celsius ?? undefined}>
      {celsius == null ? (
        EM_DASH
      ) : (
        <>
          {temperatureValue(celsius)} <span className="meteo-unit">{words.degC}</span>
        </>
      )}
    </data>
  );
}

/* Sea-level corrected pressure off the conditions block, one decimal hPa. */
export function Pressure({ station: stationProp, stationId, strings: stringsProp }: AtomProps) {
  const { context, station } = useResolvedStation("Pressure", stationProp, stationId);
  const words = resolveStrings(mergeStringOverrides(context?.strings, stringsProp));
  const hpa =
    station.status === "ok" && station.capabilities.conditions
      ? (station.reading.conditions?.seaLevelPressureHpa ?? null)
      : null;
  return (
    <data className="meteo-value meteo-pressure" value={hpa ?? undefined}>
      {hpa == null ? (
        EM_DASH
      ) : (
        <>
          {hpa.toFixed(1)} <span className="meteo-unit">{words.air.unitHpa}</span>
        </>
      )}
    </data>
  );
}

/* ---------- direction ---------- */

/* Arrow glyph + compass word + degrees via the shared DirectionCell, so the
 * atom, the strip, and the compare table can never disagree: calm (WMO:
 * below 0.5 m/s) is said in the calm word — an idle vane would fabricate a
 * bearing — and a null bearing on a blowing reading is a broken vane's dash.
 * A blowing bearing also speaks: compassSpoken spells the point out so
 * "NW 305°" reads as weather, not letters (aria.direction phrases it). */
export function Direction({ station: stationProp, stationId, strings: stringsProp }: AtomProps) {
  const { context, station } = useResolvedStation("Direction", stationProp, stationId);
  const words = resolveStrings(mergeStringOverrides(context?.strings, stringsProp));
  const reading = station.status === "ok" ? station.reading : null;
  if (reading == null) {
    return <span className="meteo-direction">{EM_DASH}</span>;
  }
  const bearingDeg = isCalm(reading.averageMps) ? null : reading.directionDeg;
  const point = bearingDeg == null ? null : compassDirection(bearingDeg);
  return (
    <span
      aria-label={
        point == null || bearingDeg == null
          ? undefined
          : words.aria.direction(words.compassSpoken[point], Math.round(bearingDeg))
      }
      className="meteo-direction"
    >
      <DirectionCell
        averageMps={reading.averageMps}
        directionDeg={reading.directionDeg}
        words={words}
      />
    </span>
  );
}

/* ---------- updated-at ---------- */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/* Past ~6 hours "n hr ago" reads as noise; the absolute time says more. */
const ABSOLUTE_AFTER_MS = 6 * HOUR_MS;
const REEVALUATE_MS = 30_000;

/* The relative-time vocabulary rides the strings module's `updated` group,
 * i18n-able like every other word. */
function relativeWords(ageMs: number, words: StationStrings): string {
  if (ageMs < MINUTE_MS) return words.updated.justNow;
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 60) return words.updated.minutesAgo(minutes);
  return words.updated.hoursAgo(Math.floor(ageMs / HOUR_MS));
}

/* Ticking relative age of the reading, re-judged every 30 seconds so a dead
 * feed visibly ages between polls; beyond ~6 hours it falls back to the
 * absolute formatTime words.
 *
 * Hydration-deterministic, useFreshness's discipline exactly: the initial
 * clock is receivedAtMs — a prop both server and client render from — never
 * Date.now(), which differs between the passes. The mount effect corrects to
 * the real clock immediately; effects run only on the client. When servedAt
 * and receivedAtMs are both present the age is anchored to the server clock
 * (age at serve + time since receipt), so a wrong client clock cannot lie. */
export function UpdatedAt({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  servedAt?: string | null;
  receivedAtMs?: number | null;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const { context, station } = useResolvedStation("UpdatedAt", stationProp, stationId);
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const words = resolveStrings(mergeStringOverrides(context?.strings, stringsProp));
  const formatTime = formatTimeProp ?? context?.formatTime ?? defaultFormatTime;
  const [nowMs, setNowMs] = useState(() => receivedAtMs ?? Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), REEVALUATE_MS);
    return () => window.clearInterval(timer);
  }, []);
  const reading = station.status === "ok" ? station.reading : null;
  if (reading == null) {
    return <span className="meteo-updated">{EM_DASH}</span>;
  }
  const observedMs = Date.parse(reading.observedAt);
  /* Server-anchored when the anchor exists; the client clock otherwise. */
  const ageMs =
    servedAt != null && receivedAtMs != null
      ? Math.max(0, Date.parse(servedAt) - observedMs) + Math.max(0, nowMs - receivedAtMs)
      : Math.max(0, nowMs - observedMs);
  return (
    <time className="meteo-updated" dateTime={reading.observedAt}>
      {ageMs >= ABSOLUTE_AFTER_MS ? formatTime(new Date(observedMs)) : relativeWords(ageMs, words)}
    </time>
  );
}

/* ---------- band chip ---------- */

/* The current reading graded against consumer thresholds, worn as a chip.
 * The consumer's `labels` supply the vocabulary (values.length + 1 words,
 * one per band); with no labels the chip states the converted speed — the
 * package never invents band words. Calm (WMO: below 0.5 m/s) is not graded
 * — a band would imply flyability judgment over air that is not moving — so
 * the chip says the calm word, the library-wide convention, without a
 * data-band. An unavailable station has nothing to grade and no thresholds
 * anywhere means no grading: both wear the em dash chip, without a
 * data-band. */
export function BandChip({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  labels,
  unit: unitProp,
  strings: stringsProp,
}: SpeedAtomProps & {
  /* Consumer-unit bounds ({ unit, values }); ambient from the provider like
   * the chart's. null opts this chip out of the provider's thresholds. */
  thresholds?: SpeedThresholds | null;
  /* One word per band, values.length + 1 entries; index = band. */
  labels?: readonly string[];
}) {
  const { context, station } = useResolvedStation("BandChip", stationProp, stationId);
  const thresholds =
    thresholdsProp === undefined ? context?.thresholds : (thresholdsProp ?? undefined);
  const unit = unitProp ?? context?.unit ?? "kmh";
  const words: StationStrings = resolveStrings(
    mergeStringOverrides(context?.strings, stringsProp),
  );
  const reading = station.status === "ok" ? station.reading : null;
  if (reading != null && isCalm(reading.averageMps)) {
    return <span className="meteo-band-chip">{words.calm}</span>;
  }
  if (reading == null || thresholds == null) {
    return <span className="meteo-band-chip">{EM_DASH}</span>;
  }
  const band = speedBand(reading.averageMps, thresholdsToMps(thresholds));
  const label =
    labels?.[band] ?? `${roundSpeed(reading.averageMps, unit)} ${words.speedUnits[unit]}`;
  return (
    <span className="meteo-band-chip" data-band={band}>
      {label}
    </span>
  );
}
