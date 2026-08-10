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
import type { ReactNode } from "react";
import type { SpeedUnit, Station } from "../../index.js";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { optionalSpeed, roundSpeed, temperatureText } from "../../index.js";
import { DirectionCell, StationNameLink } from "../lib/cells.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { requireResolved, useStationFeedContext } from "./StationFeedProvider.js";

export function StationTable({
  stations: stationsProp,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
  stationMeta,
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
  /* The sub-label under each station's name. The default is the source
   * attribution; a consumer whose rows need a different word there — the
   * sampling window the numbers are taken over, a distance from launch —
   * renders it from the station itself. Returning null removes the line. */
  stationMeta?: (station: Station) => ReactNode;
}) {
  const context = useStationFeedContext();
  const stations = requireResolved(
    "StationTable",
    "stations",
    stationsProp ?? context?.feed?.stations,
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const { formatTime, strings, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    unit: unitProp,
  });
  return (
    <div
      aria-label={words.aria.table(stations.length)}
      className="meteo-station-table"
      role="table"
    >
      <div className="meteo-station-table-row meteo-station-table-head meteo-microlabel" role="row">
        <span role="columnheader">{words.table.station}</span>
        <span role="columnheader">{words.table.wind}</span>
        <span role="columnheader">{words.table.lull}</span>
        <span role="columnheader">{words.table.gust}</span>
        <span role="columnheader">{words.table.from}</span>
        <span role="columnheader">{words.table.temp}</span>
        <span role="columnheader">{words.table.updated}</span>
      </div>
      <div className="meteo-station-table-body" role="rowgroup">
        {stations.map((station) => (
          <TableRow
            formatTime={formatTime}
            key={station.id}
            receivedAtMs={receivedAtMs}
            servedAt={servedAt}
            station={station}
            stationMeta={stationMeta}
            strings={strings}
            unit={unit}
            words={words}
          />
        ))}
      </div>
    </div>
  );
}

function TableRow({
  formatTime,
  receivedAtMs,
  servedAt,
  station,
  stationMeta,
  strings,
  unit,
  words,
}: {
  formatTime: FormatTime;
  receivedAtMs: number | null;
  servedAt: string | null;
  station: Station;
  stationMeta: ((station: Station) => ReactNode) | undefined;
  strings: StationStringOverrides | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}) {
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  return (
    <div className="meteo-station-table-row" data-status={station.status} role="row">
      <span className="meteo-station-table-station" role="cell">
        <strong>
          <StationNameLink station={station} />
        </strong>
        <small>{stationMeta ? stationMeta(station) : station.sourceLabel}</small>
      </span>
      {station.status === "ok" ? (
        <>
          <span className="meteo-station-table-wind" role="cell">
            <strong>{roundSpeed(station.reading.averageMps, unit)}</strong>
            <small>{words.speedUnits[unit]}</small>
          </span>
          <span className="meteo-station-table-lull" role="cell">
            {optionalSpeed(station.reading.lullMps, unit)}
          </span>
          <span className="meteo-station-table-gust" role="cell">
            {optionalSpeed(station.reading.gustMps, unit)}
          </span>
          <span className="meteo-station-table-from" role="cell">
            <DirectionCell
              averageMps={station.reading.averageMps}
              directionDeg={station.reading.directionDeg}
              words={words}
            />
          </span>
          <span className="meteo-station-table-temp" role="cell">
            {temperatureText(station.reading.temperatureC, words)}
          </span>
          <span className="meteo-station-table-updated" role="cell">
            <span className="meteo-station-table-time">
              {formatTime(new Date(station.reading.observedAt))}
            </span>
            {status != null && <FreshnessBadge status={status} strings={strings} />}
          </span>
        </>
      ) : (
        <span className="meteo-station-table-reason" role="cell">
          {words.reasons[station.reason]}
        </span>
      )}
    </div>
  );
}
