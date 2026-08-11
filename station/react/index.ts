"use client";
/* Public surface: THE BINDING'S OWN — components, hooks, and the provider.
 * Shared vocabulary (strings, formatting, thresholds, merge policy, chart
 * and instrument geometry, the type set) lives on "@azohra/meteo/station";
 * the polling stores and their types on "@azohra/meteo/station/client" —
 * import shared things from their home, not through a binding. The
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
export { WindArrow } from "./components/WindArrow.js";
export { DailyPattern } from "./components/DailyPattern.js";
export { WindHistoryChart } from "./components/WindHistoryChart.js";
export { WindRose } from "./components/WindRose.js";
/* StationCard is a compound: the pieces ride it as properties
 * (StationCard.Chart) and are also exported flat for toolchains that
 * dislike property access across a client boundary. */
export {
  StationCard,
  StationCardChart,
  StationCardHeader,
  StationCardInstrument,
  StationCardSummary,
} from "./components/StationCard.js";
export { useFreshness } from "./hooks/useFreshness.js";
/* All hooks take the MOUNT BASE url (e.g. "/api/wind") and build their own
 * routes; useStation composes feed + current + the shared fold. */
export { useStation } from "./hooks/useStation.js";
export { useStationCurrent } from "./hooks/useStationCurrent.js";
export { useStationFeed } from "./hooks/useStationFeed.js";
