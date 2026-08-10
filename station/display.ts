/* The ambient-default discipline, once: every component resolves its display
 * settings as explicit prop → ambient default → package default, and every
 * binding must apply the SAME precedence or the two would render the same
 * feed differently. The one subtle rule lives here with its reason:
 *
 *   thresholds === undefined  → inherit the ambient thresholds;
 *   thresholds === null       → explicitly opt OUT of ambient grading.
 *
 * `?? undefined` would erase that distinction — null would fall through to
 * the ambient value and an explicit opt-out could never be expressed — so
 * the trichotomy is implemented with `=== undefined`, exactly once, here. */
import type { Station, StationFeed } from "./contract.js";
import type { SpeedThresholds, SpeedUnit } from "./derive.js";
import { defaultFormatTime, mergeStringOverrides, resolveStrings } from "./strings.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "./strings.js";

/* What an ambient provider carries — structurally a subset of the React
 * context value and of the elements provider's state. */
export type DisplayDefaults = {
  strings?: StationStringOverrides | undefined;
  unit?: SpeedUnit | undefined;
  formatTime?: FormatTime | undefined;
  thresholds?: SpeedThresholds | undefined;
};

/* What a component accepts — thresholds adds null, the explicit opt-out. */
export type DisplayProps = {
  strings?: StationStringOverrides | undefined;
  unit?: SpeedUnit | undefined;
  formatTime?: FormatTime | undefined;
  thresholds?: SpeedThresholds | null | undefined;
};

export type ResolvedDisplay = {
  /* The merged override layers, for components that re-provide them. */
  strings: StationStringOverrides | undefined;
  /* The full vocabulary, ready to print from. */
  words: StationStrings;
  unit: SpeedUnit;
  formatTime: FormatTime;
  thresholds: SpeedThresholds | undefined;
};

export function resolveDisplay(
  defaults: DisplayDefaults | null | undefined,
  props: DisplayProps,
): ResolvedDisplay {
  const strings = mergeStringOverrides(defaults?.strings, props.strings);
  return {
    strings,
    words: resolveStrings(strings),
    unit: props.unit ?? defaults?.unit ?? "kmh",
    formatTime: props.formatTime ?? defaults?.formatTime ?? defaultFormatTime,
    thresholds:
      props.thresholds === undefined ? defaults?.thresholds : (props.thresholds ?? undefined),
  };
}

/* The documented station resolution order for per-station components inside
 * an ambient feed: stationId → primaryStationId → stations[0], over a feed
 * that may be absent. */
export function resolveStation(
  feed: StationFeed | null | undefined,
  stationId: string | undefined,
): Station | null {
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
 * mistake, and silence would render a mystery blank. Say so — each binding
 * supplies the ambientHint naming ITS provider, so the error always points
 * at the fix the reader can actually type. */
export function requireResolved<T>(
  component: string,
  what: string,
  value: T | null | undefined,
  ambientHint: string,
): T {
  if (value == null) {
    throw new Error(
      `<${component}> resolved no ${what} — pass the prop explicitly or ${ambientHint}.`,
    );
  }
  return value;
}
