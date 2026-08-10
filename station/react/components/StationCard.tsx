"use client";
/* The composite card, as a compound component. <StationCard> is a context
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
import { resolveDisplay, stationFreshnessThresholds, summaryEntries } from "../../index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { mergeStringOverrides } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { CurrentConditions } from "./CurrentConditions.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import {
  requireResolved,
  resolveStation,
  useStationFeedContext,
} from "./StationFeedProvider.js";
import { WindHistoryChart } from "./WindHistoryChart.js";

type StationCardContextValue = {
  station: Station;
  servedAt: string | null;
  receivedAtMs: number | null;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  /* Provider overrides already merged in; subcomponents merge once more. */
  strings: StationStringOverrides | undefined;
  formatTime: FormatTime;
};

const StationCardContext = createContext<StationCardContextValue | null>(null);

/* A subcomponent outside the provider has no station to draw — that is a
 * wiring mistake, and silence would render a mystery blank. Say so. */
function useStationCardContext(subcomponent: string): StationCardContextValue {
  const context = useContext(StationCardContext);
  if (context == null) {
    throw new Error(
      `<StationCard.${subcomponent}> must render inside <StationCard> — ` +
        "the provider carries the station, clocks, and display settings.",
    );
  }
  return context;
}

function StationCardRoot({
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
    "StationCard",
    "station",
    stationProp ?? resolveStation(ambient, stationId),
  );
  const servedAt = servedAtProp ?? ambient?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (ambient?.receivedAtMs ?? null);
  const { formatTime, strings, thresholds, unit } = resolveDisplay(ambient, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  return (
    <StationCardContext.Provider
      value={{ station, servedAt, receivedAtMs, thresholds, unit, strings, formatTime }}
    >
      <article className="meteo-station-card" data-status={station.status}>
        {children === undefined ? (
          <>
            <StationCardHeader />
            <StationCardInstrument />
            <StationCardChart />
            <StationCardSummary />
          </>
        ) : (
          children
        )}
      </article>
    </StationCardContext.Provider>
  );
}

/* Identity, attribution, and the freshness badge. */
export function StationCardHeader({
  strings,
}: {
  strings?: StationStringOverrides;
} = {}) {
  const context = useStationCardContext("Header");
  const { station, servedAt, receivedAtMs } = context;
  const { strings: resolvedStrings, words } = resolveDisplay(context, { strings });
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );

  return (
    <header className="meteo-station-card-header">
      <div className="meteo-station-card-identity">
        <h3 className="meteo-station-card-name">
          {station.pageUrl ? (
            <a href={station.pageUrl} rel="noreferrer" target="_blank">
              {station.name} ↗
            </a>
          ) : (
            station.name
          )}
        </h3>
        <p className="meteo-station-card-meta">
          {/* Attribution rides the header; the source label is display-only. */}
          <span className="meteo-station-card-source">{station.sourceLabel}</span>
          {station.elevationM != null && (
            <span className="meteo-station-card-elevation">
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
export function StationCardInstrument({
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
  const context = useStationCardContext("Instrument");
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

export function StationCardChart({
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
  const context = useStationCardContext("Chart");
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
export function StationCardSummary({
  unit,
  strings,
  formatTime,
}: {
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
} = {}) {
  const context = useStationCardContext("Summary");
  const { formatTime: resolvedFormatTime, unit: resolvedUnit, words } = resolveDisplay(context, {
    formatTime,
    strings,
    unit,
  });
  const { station } = context;

  /* The label/value strings are the shared summaryEntries rule, so every
   * binding's strip prints the same characters over the same window. */
  const summary = summaryEntries(station, resolvedUnit, words, resolvedFormatTime);
  if (summary == null) return null;

  return (
    <dl
      aria-label={words.aria.summary(resolvedFormatTime(new Date(summary.periodEndedAt)))}
      className="meteo-summary"
    >
      {summary.entries.map((entry) => (
        <div className="meteo-summary-item" key={entry.label}>
          <dt className="meteo-microlabel">{entry.label}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* Subcomponents ride the root as properties (StationCard.Chart) and as named
 * exports (StationCardChart) — the latter for consumers whose toolchain
 * dislikes property access across a client boundary. */
export const StationCard = Object.assign(StationCardRoot, {
  Header: StationCardHeader,
  Instrument: StationCardInstrument,
  Chart: StationCardChart,
  Summary: StationCardSummary,
});
