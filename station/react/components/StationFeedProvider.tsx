"use client";
/* The package-wide ambient context: one provider carries the feed, the
 * client clock (receivedAtMs — servedAt is read off the feed itself), and
 * the display defaults (strings, unit, formatTime, thresholds, locale), so a
 * page composes components without re-threading the same props into each.
 *
 * The provider is a DEFAULT, never a requirement: every component still
 * works fully via explicit props with no provider anywhere, and an explicit
 * prop always overrides the context (the same `??` discipline WindStation's
 * subcomponents use, promoted package-wide).
 *
 * Station resolution for per-station components inside a provider, in order:
 *   1. an explicit `station` prop — always wins;
 *   2. a `stationId` prop, looked up in the provider's feed;
 *   3. the feed's primaryStationId;
 *   4. the feed's first station.
 * A component that resolves no station is a wiring mistake and throws with
 * these words rather than rendering a mystery blank. */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { SpeedUnit, Station, StationFeed } from "../../index.js";
import { localeFormatTime } from "../lib/strings.js";
import type { FormatTime, StationStringOverrides } from "../lib/strings.js";
import type { SpeedThresholds } from "../lib/thresholds.js";

export type StationFeedContextValue = {
  feed: StationFeed | null;
  receivedAtMs: number | null;
  strings: StationStringOverrides | undefined;
  unit: SpeedUnit | undefined;
  formatTime: FormatTime | undefined;
  thresholds: SpeedThresholds | undefined;
};

const StationFeedContext = createContext<StationFeedContextValue | null>(null);

export function StationFeedProvider({
  feed,
  receivedAtMs,
  strings,
  unit,
  formatTime,
  thresholds,
  locale,
  children,
}: {
  feed: StationFeed | null;
  /* When this client received the feed; null (feed still loading) simply
   * withholds freshness badges downstream. */
  receivedAtMs: number | null;
  strings?: StationStringOverrides;
  unit?: SpeedUnit;
  formatTime?: FormatTime;
  thresholds?: SpeedThresholds;
  /* Pins the default time format to one locale so SSR and hydration passes
   * cannot disagree; ignored when formatTime is given. */
  locale?: string;
  children?: ReactNode;
}) {
  const resolvedFormatTime =
    formatTime ?? (locale == null ? undefined : localeFormatTime(locale));
  const value = useMemo<StationFeedContextValue>(
    () => ({ feed, receivedAtMs, strings, unit, formatTime: resolvedFormatTime, thresholds }),
    [feed, receivedAtMs, strings, unit, resolvedFormatTime, thresholds],
  );
  return <StationFeedContext.Provider value={value}>{children}</StationFeedContext.Provider>;
}

/* Null when no provider is mounted — components treat that as "no ambient
 * defaults", never as an error. */
export function useStationFeedContext(): StationFeedContextValue | null {
  return useContext(StationFeedContext);
}

/* The documented resolution order (stationId → primaryStationId →
 * stations[0]) over a context that may be absent. */
export function resolveStation(
  context: StationFeedContextValue | null,
  stationId: string | undefined,
): Station | null {
  const feed = context?.feed;
  if (feed == null) return null;
  if (stationId != null) {
    return feed.stations.find((station) => station.id === stationId) ?? null;
  }
  if (feed.primaryStationId != null) {
    const primary = feed.stations.find((station) => station.id === feed.primaryStationId);
    if (primary != null) return primary;
  }
  return feed.stations[0] ?? null;
}

/* Required-data guard: absence of a station (or a stations list) is a wiring
 * mistake, and silence would render a mystery blank. Say so. */
export function requireResolved<T>(component: string, what: string, value: T | null | undefined): T {
  if (value == null) {
    throw new Error(
      `<${component}> resolved no ${what} — pass the prop explicitly or render ` +
        "inside <StationFeedProvider> with a feed.",
    );
  }
  return value;
}
