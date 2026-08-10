"use client";
/* Every station on one grid, one row each, seven columns. Rows are
 * structurally fixed whatever a station reports: a value the station does not
 * have is an em dash in place, never an absent cell, because readings are
 * replaced on every poll and geometry that depended on which values came back
 * non-null would twitch on every tick. An unavailable station keeps its row;
 * the reason words span the data cells.
 *
 * A real table for screen readers: roles are explicit because grid display
 * drops the implicit ones. */
import type { SpeedUnit, Station } from "../../index.js";
import {
  compassDirection,
  speedFromMps,
  isCalm,
  stationFreshnessThresholds,
} from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { EM_DASH, defaultFormatTime, mergeStringOverrides, resolveStrings } from "../lib/strings.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../lib/strings.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { requireResolved, useStationFeedContext } from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

export function StationCompare({
  stations: stationsProp,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  /* A fleet component takes `stations` (per-station components take
   * `station`). Inside <StationFeedProvider> the provider's feed supplies
   * them; unresolvable throws. */
  stations?: readonly Station[];
  /* Freshness inputs; absent everywhere the badges are simply withheld. */
  servedAt?: string;
  receivedAtMs?: number | null;
  /* Display unit only: shown speeds convert; the wire stays m/s. */
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const stations = requireResolved(
    "StationCompare",
    "stations",
    stationsProp ?? context?.feed?.stations,
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const unit = unitProp ?? context?.unit ?? "kmh";
  const strings = mergeStringOverrides(context?.strings, stringsProp);
  const formatTime = formatTimeProp ?? context?.formatTime ?? defaultFormatTime;
  const words = resolveStrings(strings);
  return (
    <div
      aria-label={words.aria.compare(stations.length)}
      className="wind-compare"
      role="table"
    >
      <div className="wind-compare-row wind-compare-head wind-microlabel" role="row">
        <span role="columnheader">{words.table.station}</span>
        <span role="columnheader">{words.table.wind}</span>
        <span role="columnheader">{words.table.lull}</span>
        <span role="columnheader">{words.table.gust}</span>
        <span role="columnheader">{words.table.from}</span>
        <span role="columnheader">{words.table.temp}</span>
        <span role="columnheader">{words.table.updated}</span>
      </div>
      <div className="wind-compare-body" role="rowgroup">
        {stations.map((station) => (
          <CompareRow
            formatTime={formatTime}
            key={station.id}
            receivedAtMs={receivedAtMs}
            servedAt={servedAt}
            station={station}
            strings={strings}
            unit={unit}
            words={words}
          />
        ))}
      </div>
    </div>
  );
}

function CompareRow({
  formatTime,
  receivedAtMs,
  servedAt,
  station,
  strings,
  unit,
  words,
}: {
  formatTime: FormatTime;
  receivedAtMs: number | null;
  servedAt: string | null;
  station: Station;
  strings: StationStringOverrides | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}) {
  const shown = (averageMps: number) => Math.round(speedFromMps(averageMps, unit));
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  return (
    <div className="wind-compare-row" data-status={station.status} role="row">
      <span className="wind-compare-station" role="cell">
        <strong>
          {station.pageUrl ? (
            <a href={station.pageUrl} rel="noreferrer" target="_blank">
              {station.name}
            </a>
          ) : (
            station.name
          )}
        </strong>
        <small>{station.sourceLabel}</small>
      </span>
      {station.status === "ok" ? (
        <>
          <span className="wind-compare-wind" role="cell">
            <strong>{shown(station.reading.averageMps)}</strong>
            <small>{words.speedUnits[unit]}</small>
          </span>
          <span className="wind-compare-lull" role="cell">
            {station.reading.lullMps == null ? EM_DASH : shown(station.reading.lullMps)}
          </span>
          <span className="wind-compare-gust" role="cell">
            {station.reading.gustMps == null ? EM_DASH : shown(station.reading.gustMps)}
          </span>
          {/* Calm (WMO: below 0.5 m/s) withholds direction, said in a word;
           * a null on a blowing reading is a broken vane and earns the dash. */}
          <span className="wind-compare-from" role="cell">
            {isCalm(station.reading.averageMps) ? (
              words.calm
            ) : station.reading.directionDeg == null ? (
              EM_DASH
            ) : (
              <>
                <WindArrow deg={station.reading.directionDeg} />{" "}
                {compassDirection(station.reading.directionDeg)}{" "}
                {Math.round(station.reading.directionDeg)}°
              </>
            )}
          </span>
          <span className="wind-compare-temp" role="cell">
            {station.reading.temperatureC == null
              ? EM_DASH
              : `${station.reading.temperatureC.toFixed(1)} ${words.degC}`}
          </span>
          <span className="wind-compare-updated" role="cell">
            <span className="wind-compare-time">
              {formatTime(new Date(station.reading.observedAt))}
            </span>
            {status != null && <FreshnessBadge status={status} strings={strings} />}
          </span>
        </>
      ) : (
        <span className="wind-compare-reason" role="cell">
          {words.reasons[station.reason]}
        </span>
      )}
    </div>
  );
}
