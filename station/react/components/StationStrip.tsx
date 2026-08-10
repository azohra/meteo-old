"use client";
/* The per-station one-liner: the reading a StationTable row states,
 * standalone — for overview boards, page headers, and anywhere one station
 * earns one line. Formatting rides the same cell helpers the station table
 * uses, so a strip and a table row can never disagree about a dash, a calm
 * word, or a rounded speed.
 *
 * Fixed geometry per station: an absent VALUE is an em dash in place, never
 * an absent cell, because readings are replaced on every poll; only a
 * CAPABILITY the station lacks omits its cell — a strip stands alone, with
 * no fleet column grid to hold (that alignment is StationTable's job). An
 * unavailable station keeps its line: the name stays, the reason words stand
 * in for the reading cells, and the height holds. */
import type { SpeedUnit, Station } from "../../index.js";
import { stationFreshnessThresholds } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import {
  DirectionCell,
  StationNameLink,
  optionalSpeed,
  roundSpeed,
  temperatureText,
} from "../lib/cells.js";
import { defaultFormatTime, mergeStringOverrides, resolveStrings } from "../lib/strings.js";
import type { FormatTime, StationStringOverrides } from "../lib/strings.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";

export function StationStrip({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  /* Freshness inputs; absent everywhere (no prop, no provider feed) the
   * badge is simply withheld — null never fabricates a status. */
  servedAt?: string | null;
  receivedAtMs?: number | null;
  /* Display unit only: shown speeds convert; the wire stays m/s. */
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "StationStrip",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const unit = unitProp ?? context?.unit ?? "kmh";
  const strings = mergeStringOverrides(context?.strings, stringsProp);
  const formatTime = formatTimeProp ?? context?.formatTime ?? defaultFormatTime;
  const words = resolveStrings(strings);
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  return (
    <div
      aria-label={words.aria.strip(station.name)}
      className="meteo-strip"
      data-status={station.status}
      role="group"
    >
      <span className="meteo-strip-station">
        <StationNameLink station={station} />
      </span>
      {station.status === "ok" ? (
        <>
          <span className="meteo-strip-wind">
            <strong>{roundSpeed(station.reading.averageMps, unit)}</strong>
            <small>{words.speedUnits[unit]}</small>
          </span>
          {station.capabilities.gustLull && (
            <>
              <span className="meteo-strip-lull">
                <small className="wind-microlabel">{words.lullLabel}</small>
                {optionalSpeed(station.reading.lullMps, unit)}
              </span>
              <span className="meteo-strip-gust">
                <small className="wind-microlabel">{words.gustLabel}</small>
                {optionalSpeed(station.reading.gustMps, unit)}
              </span>
            </>
          )}
          <span className="meteo-strip-from">
            <DirectionCell
              averageMps={station.reading.averageMps}
              directionDeg={station.reading.directionDeg}
              words={words}
            />
          </span>
          {station.capabilities.temperature && (
            <span className="meteo-strip-temp">
              {temperatureText(station.reading.temperatureC, words)}
            </span>
          )}
          <span className="meteo-strip-updated">
            <span className="meteo-strip-time">
              {formatTime(new Date(station.reading.observedAt))}
            </span>
            {status != null && <FreshnessBadge status={status} strings={strings} />}
          </span>
        </>
      ) : (
        <span className="meteo-strip-reason">{words.reasons[station.reason]}</span>
      )}
    </div>
  );
}
