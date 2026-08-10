"use client";
/* Public surface: components take data props, hooks compose outside. The
 * "use client" directive here and in every module makes the package land on
 * the client side of an App Router boundary without consumer wrappers. */
export { AirMatrix } from "./components/AirMatrix.js";
/* The text atoms: the smallest reading fragments as standalone inline
 * elements, for consumers composing their own layouts out of
 * package-consistent pieces. */
export {
  BandChip,
  Direction,
  Gust,
  Lull,
  Pressure,
  Speed,
  Temperature,
  UpdatedAt,
} from "./components/atoms.js";
export { CurrentConditions } from "./components/CurrentConditions.js";
/* The visual atoms: the instrument's gauge alone, and the history chart at
 * word size. */
export { Dial } from "./components/Dial.js";
export { FreshnessBadge } from "./components/FreshnessBadge.js";
export { Sparkline } from "./components/Sparkline.js";
export { StationTable } from "./components/StationTable.js";
/* The ambient default layer: components read feed/clock/display defaults
 * from the provider and explicit props always override it. */
export { StationFeedProvider, useStationFeedContext } from "./components/StationFeedProvider.js";
export type { StationFeedContextValue } from "./components/StationFeedProvider.js";
export { StationStrip } from "./components/StationStrip.js";
export { TrendChart } from "./components/TrendChart.js";
export type { TrendSeries } from "./components/TrendChart.js";
export { WindArrow } from "./components/WindArrow.js";
export { WindHistoryChart } from "./components/WindHistoryChart.js";
export { WindRose } from "./components/WindRose.js";
export type { FavorableDirection } from "./components/WindRose.js";
/* WindStation is a compound: the pieces ride it as properties
 * (WindStation.Chart) and are also exported flat for toolchains that
 * dislike property access across a client boundary. */
export {
  WindStation,
  WindStationChart,
  WindStationHeader,
  WindStationInstrument,
  WindStationSummary,
} from "./components/WindStation.js";
export { useFreshness } from "./hooks/useFreshness.js";
/* All hooks take the MOUNT BASE url (e.g. "/api/wind") and build their own
 * routes; useStation composes feed + current + mergeCurrent. */
export { useStation } from "./hooks/useStation.js";
export { useStationCurrent } from "./hooks/useStationCurrent.js";
export { useStationFeed } from "./hooks/useStationFeed.js";
export type { PollError } from "./hooks/usePolledJson.js";
export { airSummary, lastStrikeWords } from "./lib/air.js";
export { mergeCurrent } from "./lib/mergeCurrent.js";
export type { MergeResult } from "./lib/mergeCurrent.js";
export {
  EM_DASH,
  defaultFormatTime,
  defaultStrings,
  localeFormatTime,
  mergeStringOverrides,
} from "./lib/strings.js";
export type { FormatTime, StationStringOverrides, StationStrings } from "./lib/strings.js";
export { thresholdsToMps } from "./lib/thresholds.js";
export type { SpeedThresholds } from "./lib/thresholds.js";
