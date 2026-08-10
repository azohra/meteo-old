"use client";
/* The composite card, as a compound component. <WindStation> is a context
 * provider carrying the station, the clocks (servedAt/receivedAtMs), and the
 * display settings; its pieces — Header, Instrument, Chart, Summary — read
 * that context so a consumer composes without re-threading props. The root's
 * own props are optional overrides over an ambient <StationFeedProvider>.
 * With no children authored (children === undefined) it renders the full
 * default composition; ANY authored children — even ones that evaluate to
 * false — mean the consumer composes the card and only the asked-for pieces
 * appear. Every subcomponent also accepts explicit props that override the
 * context, so one chart in a card can wear its own thresholds without
 * forking the provider.
 *
 * The summary strip is derived from the same records the chart drew, so
 * every stat under the chart shares the chart's window. */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { periodSummary, stationFreshnessThresholds } from "../../index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { roundSpeed } from "../lib/cells.js";
import { EM_DASH, defaultFormatTime, mergeStringOverrides, resolveStrings } from "../lib/strings.js";
import type { FormatTime, StationStringOverrides } from "../lib/strings.js";
import type { SpeedThresholds } from "../lib/thresholds.js";
import { CurrentConditions } from "./CurrentConditions.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";
import { WindHistoryChart } from "./WindHistoryChart.js";

type WindStationContextValue = {
  station: Station;
  servedAt: string | null;
  receivedAtMs: number | null;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  /* Provider overrides already merged in; subcomponents merge once more. */
  strings: StationStringOverrides | undefined;
  formatTime: FormatTime;
};

const WindStationContext = createContext<WindStationContextValue | null>(null);

/* A subcomponent outside the provider has no station to draw — that is a
 * wiring mistake, and silence would render a mystery blank. Say so. */
function useWindStationContext(subcomponent: string): WindStationContextValue {
  const context = useContext(WindStationContext);
  if (context == null) {
    throw new Error(
      `<WindStation.${subcomponent}> must render inside <WindStation> — ` +
        "the provider carries the station, clocks, and display settings.",
    );
  }
  return context;
}

function WindStationRoot({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  thresholds: thresholdsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
  children,
}: {
  /* Explicit prop wins; inside <StationFeedProvider> the station resolves
   * via stationId → primaryStationId → stations[0]. Unresolvable throws. */
  station?: Station;
  stationId?: string;
  /* Freshness inputs; absent everywhere (no prop, no provider feed) the
   * header badge is simply withheld. */
  servedAt?: string;
  receivedAtMs?: number | null;
  /* Consumer-unit bounds ({ unit, values }); `unit` converts only what is
   * shown. null opts out of the provider's thresholds. */
  thresholds?: SpeedThresholds | null;
  /* Display unit only: threads to the instrument, chart, and summary strip. */
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
  /* `children === undefined` — no children authored at all — renders the
   * default composition. ANY authored children value, including the `false`
   * or `null` a `{cond && <X/>}` expression can produce, means composition
   * mode: the consumer said what appears, and an all-false composition
   * renders an empty card rather than surprise-defaulting to everything. */
  children?: ReactNode;
}) {
  const ambient = useStationFeedContext();
  const station = requireResolved(
    "WindStation",
    "station",
    stationProp ?? resolveStation(ambient, stationId),
  );
  const servedAt = servedAtProp ?? ambient?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (ambient?.receivedAtMs ?? null);
  const thresholds =
    thresholdsProp === undefined ? ambient?.thresholds : (thresholdsProp ?? undefined);
  const unit = unitProp ?? ambient?.unit ?? "kmh";
  const strings = mergeStringOverrides(ambient?.strings, stringsProp);
  const formatTime = formatTimeProp ?? ambient?.formatTime ?? defaultFormatTime;
  return (
    <WindStationContext.Provider
      value={{ station, servedAt, receivedAtMs, thresholds, unit, strings, formatTime }}
    >
      <article className="wind-station" data-status={station.status}>
        {children === undefined ? (
          <>
            <WindStationHeader />
            <WindStationInstrument />
            <WindStationChart />
            <WindStationSummary />
          </>
        ) : (
          children
        )}
      </article>
    </WindStationContext.Provider>
  );
}

/* Identity, attribution, and the freshness badge. */
export function WindStationHeader({
  strings,
}: {
  strings?: StationStringOverrides;
} = {}) {
  const context = useWindStationContext("Header");
  const { station, servedAt, receivedAtMs } = context;
  const resolvedStrings = mergeStringOverrides(context.strings, strings);
  const words = resolveStrings(resolvedStrings);
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );

  return (
    <header className="wind-station-header">
      <div className="wind-station-identity">
        <h3 className="wind-station-name">
          {station.pageUrl ? (
            <a href={station.pageUrl} rel="noreferrer" target="_blank">
              {station.name} ↗
            </a>
          ) : (
            station.name
          )}
        </h3>
        <p className="wind-station-meta">
          {/* Attribution rides the header; the source label is display-only. */}
          <span className="wind-station-source">{station.sourceLabel}</span>
          {station.elevationM != null && (
            <span className="wind-station-elevation">
              {" "}· {words.elevation(Math.round(station.elevationM))}
            </span>
          )}
        </p>
      </div>
      {status != null && <FreshnessBadge status={status} strings={resolvedStrings} />}
    </header>
  );
}

/* The dial. A page whose station table already states the current reading
 * simply leaves this piece out of its composition. */
export function WindStationInstrument({
  thresholds,
  unit,
  strings,
  formatTime,
}: {
  /* null opts out of the card's (and any provider's) thresholds. */
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
} = {}) {
  const context = useWindStationContext("Instrument");
  const resolvedThresholds = thresholds === undefined ? context.thresholds : (thresholds ?? undefined);
  return (
    <CurrentConditions
      formatTime={formatTime ?? context.formatTime}
      receivedAtMs={context.receivedAtMs}
      servedAt={context.servedAt}
      station={context.station}
      strings={mergeStringOverrides(context.strings, strings)}
      /* Pinned to null when absent: undefined would let the leaf re-consult
       * an ambient provider and undo an explicit opt-out here. */
      thresholds={resolvedThresholds ?? null}
      unit={unit ?? context.unit}
    />
  );
}

export function WindStationChart({
  thresholds,
  unit,
  plotHeight,
  strings,
  formatTime,
}: {
  /* null opts out of the card's (and any provider's) thresholds. */
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  plotHeight?: number;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
} = {}) {
  const context = useWindStationContext("Chart");
  const resolvedThresholds = thresholds === undefined ? context.thresholds : (thresholds ?? undefined);
  return (
    <WindHistoryChart
      formatTime={formatTime ?? context.formatTime}
      plotHeight={plotHeight}
      station={context.station}
      strings={mergeStringOverrides(context.strings, strings)}
      /* Pinned to null when absent: undefined would let the leaf re-consult
       * an ambient provider and undo an explicit opt-out here. */
      thresholds={resolvedThresholds ?? null}
      unit={unit ?? context.unit}
    />
  );
}

/* Stats the instrument cannot measure are dropped rather than dashed: the
 * strip reads as a complete footnote, and a permanent hole says nothing. A
 * value the instrument measures but missed stays an em dash in place. */
export function WindStationSummary({
  unit,
  strings,
  formatTime,
}: {
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
} = {}) {
  const context = useWindStationContext("Summary");
  const words = resolveStrings(mergeStringOverrides(context.strings, strings));
  const resolvedUnit = unit ?? context.unit;
  const resolvedFormatTime = formatTime ?? context.formatTime;
  const { station } = context;

  const history = station.status === "ok" ? station.history : null;
  const summary = history == null || history.points.length === 0 ? null : periodSummary(history);
  if (summary == null) return null;

  const capabilities = station.capabilities;
  const shown = (averageMps: number) => roundSpeed(averageMps, resolvedUnit);
  const unitLabel = words.speedUnits[resolvedUnit];
  const entries: { label: string; value: string }[] = [
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
                      : ` · ${resolvedFormatTime(new Date(summary.peakGustAt))}`
                  }`,
          },
          {
            label: words.minLabel,
            value:
              summary.lowestLullMps == null ? EM_DASH : `${shown(summary.lowestLullMps)} ${unitLabel}`,
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

  return (
    <dl
      aria-label={words.aria.summary(resolvedFormatTime(new Date(summary.periodEndedAt)))}
      className="wind-summary"
    >
      {entries.map((entry) => (
        <div className="wind-summary-item" key={entry.label}>
          <dt className="wind-microlabel">{entry.label}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* Subcomponents ride the root as properties (WindStation.Chart) and as named
 * exports (WindStationChart) — the latter for consumers whose toolchain
 * dislikes property access across a client boundary. */
export const WindStation = Object.assign(WindStationRoot, {
  Header: WindStationHeader,
  Instrument: WindStationInstrument,
  Chart: WindStationChart,
  Summary: WindStationSummary,
});
