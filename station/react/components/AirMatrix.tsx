"use client";
/* The air matrix: humidity through lightning, which only conditions-capable
 * stations carry sensors for. Folded behind a disclosure because a wind page
 * reads the wind first — but the trigger line carries live values (humidity,
 * rain state, lightning recency), so the fold cannot be mistaken for missing
 * data, and lightning stays visible while folded.
 *
 * Capability gates structure: stations without the conditions capability are
 * omitted entirely — a fact about the instrument, not a gap in today's data
 * — so the matrix never shows a column of dashes for a wind-only logger. A
 * capable station whose sensor is dark right now keeps its column and wears
 * em dashes cell by cell. Rows exist only where at least one station reports
 * the field. Numbers live in the cells, units in the row labels, words only
 * where there is no number (pressure trend). The last lightning strike is a
 * sentence under the table: a distance and a time are not a count. */
import { useId, useState } from "react";
import type { AirConditions, Station } from "../../index.js";
import { airSummary, lastStrikeWords } from "../lib/air.js";
import { EM_DASH, defaultFormatTime, mergeStringOverrides, resolveStrings } from "../lib/strings.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../lib/strings.js";
import { requireResolved, useStationFeedContext } from "./StationFeedProvider.js";

type AirRow = {
  label: string;
  unit: string;
  value: (conditions: AirConditions) => string | null;
};

/* Row order follows the reference discipline: body feel first, then the
 * pressure story, then sun, then water, then hazard. */
function airRows(words: StationStrings): AirRow[] {
  const air = words.air;
  return [
    /* Feels-like rides the reading, not the conditions block; it is threaded
     * in via a synthetic field below. */
    {
      label: air.humidity,
      unit: air.unitPercent,
      value: (c) =>
        c.relativeHumidityPercent == null ? null : `${Math.round(c.relativeHumidityPercent)}`,
    },
    {
      label: air.dewPoint,
      unit: words.degC,
      value: (c) => c.dewPointC?.toFixed(1) ?? null,
    },
    {
      label: air.pressure,
      unit: air.unitHpa,
      value: (c) => c.seaLevelPressureHpa?.toFixed(1) ?? null,
    },
    {
      /* Word cells, so the label carries no unit. */
      label: air.pressureTrend,
      unit: "",
      value: (c) =>
        c.pressureTrend === "falling"
          ? air.trendFalling
          : c.pressureTrend === "rising"
            ? air.trendRising
            : c.pressureTrend === "steady"
              ? air.trendSteady
              : null,
    },
    {
      label: air.solar,
      unit: air.unitWm2,
      value: (c) => (c.solarRadiationWm2 == null ? null : `${Math.round(c.solarRadiationWm2)}`),
    },
    {
      label: air.uv,
      unit: air.unitIndex,
      value: (c) => (c.uvIndex == null ? null : `${Math.round(c.uvIndex * 10) / 10}`),
    },
    {
      label: air.rainRate,
      unit: air.unitMmPerHour,
      value: (c) => c.precipitationRateMmPerHour?.toFixed(1) ?? null,
    },
    {
      label: air.rainToday,
      unit: air.unitMm,
      value: (c) => c.precipitationTodayMm?.toFixed(1) ?? null,
    },
    {
      label: air.rainMinutes,
      unit: air.unitMinutes,
      value: (c) =>
        c.precipitationMinutesToday == null ? null : `${c.precipitationMinutesToday}`,
    },
    {
      label: air.lightning,
      unit: air.unitStrikesPastHour,
      value: (c) =>
        c.lightningStrikeCountLastHour == null ? null : `${c.lightningStrikeCountLastHour}`,
    },
  ];
}

export function AirMatrix({
  stations: stationsProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  /* A fleet component takes `stations` (per-station components take
   * `station`). Inside <StationFeedProvider> the provider's feed supplies
   * them; unresolvable throws. The matrix carries no speed field, so it
   * takes no display `unit`. */
  stations?: readonly Station[];
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const stations = requireResolved(
    "AirMatrix",
    "stations",
    stationsProp ?? context?.feed?.stations,
  );
  const strings = mergeStringOverrides(context?.strings, stringsProp);
  const formatTime = formatTimeProp ?? context?.formatTime ?? defaultFormatTime;
  const words = resolveStrings(strings);
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const capable = stations.filter((station) => station.capabilities.conditions);
  /* No capable station: the fleet has no such sensors — render nothing
   * rather than an empty shell. */
  if (capable.length === 0) return null;

  /* The trigger summary and the strike sentence speak for the first station
   * actually reporting a conditions block right now. */
  const firstConditions =
    capable
      .map((station) => station.reading?.conditions ?? null)
      .find((conditions) => conditions != null) ?? null;

  /* Feels-like is the one row read off the reading rather than the
   * conditions block, so it is filtered on its own. */
  const feelsLikeRow = capable.some((station) => station.reading?.windChillC != null);
  const rows = airRows(words).filter((row) =>
    capable.some((station) => {
      const conditions = station.reading?.conditions;
      return conditions != null && row.value(conditions) != null;
    }),
  );

  const rowTemplate = {
    gridTemplateColumns: `minmax(7.5rem, 1.4fr) repeat(${capable.length}, minmax(4.5rem, 1fr))`,
  } as const;

  return (
    <section className="meteo-air" data-expanded={expanded}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="meteo-air-trigger"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <strong className="meteo-air-title">{words.air.title}</strong>
        <span className="meteo-air-summary">
          {firstConditions == null
            ? words.air.summaryFallback
            : airSummary(firstConditions, words)}
        </span>
      </button>
      {/* Kept mounted so aria-controls always points at something real; the
       * hidden attribute is the fold. */}
      <div className="meteo-air-panel" hidden={!expanded} id={panelId}>
        <div aria-label={words.aria.air(capable.length)} className="meteo-air-matrix" role="table">
          <div className="meteo-air-row meteo-air-head" role="row" style={rowTemplate}>
            {/* Empty corner header keeps AT column counts aligned. */}
            <span className="meteo-air-corner" role="columnheader" />
            {capable.map((station) => (
              <span className="wind-microlabel" key={station.id} role="columnheader">
                {station.name}
              </span>
            ))}
          </div>
          {feelsLikeRow && (
            <div className="meteo-air-row" role="row" style={rowTemplate}>
              <span className="meteo-air-label" role="rowheader">
                {words.air.feelsLike}
                <small>{words.degC}</small>
              </span>
              {capable.map((station) => (
                <AirCell key={station.id} value={station.reading?.windChillC?.toFixed(1) ?? null} />
              ))}
            </div>
          )}
          {rows.map((row) => (
            <div className="meteo-air-row" key={row.label} role="row" style={rowTemplate}>
              <span className="meteo-air-label" role="rowheader">
                {row.label}
                <small>{row.unit}</small>
              </span>
              {capable.map((station) => {
                const conditions = station.reading?.conditions;
                return (
                  <AirCell
                    key={station.id}
                    value={conditions == null ? null : row.value(conditions)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <p className="meteo-air-note">
          {firstConditions == null
            ? words.air.noStrike
            : lastStrikeWords(firstConditions, formatTime, words)}
        </p>
      </div>
    </section>
  );
}

function AirCell({ value }: { value: string | null }) {
  return (
    <span className="meteo-air-cell" role="cell">
      {value ?? EM_DASH}
    </span>
  );
}
