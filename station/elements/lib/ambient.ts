/* The ambient value <meteo-station-feed> provides and every element
 * consumes — the same shape as the react binding's StationFeedContextValue,
 * and structurally a DisplayDefaults, so the shared resolveDisplay applies
 * to it unchanged. In its own module so the base class and the provider
 * element can both import it without a cycle. */
import type { SpeedThresholds, SpeedUnit, StationFeed } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";

export const STATION_FEED_CONTEXT_KEY = "station-feed";

/* The wiring-error hint naming THIS binding's provider (the react binding
 * names <StationFeedProvider> in the same slot). */
export const ELEMENTS_AMBIENT_HINT = "render inside <meteo-station-feed> with a feed";

export type AmbientStationFeed = {
  feed: StationFeed | null;
  receivedAtMs: number | null;
  strings: StationStringOverrides | undefined;
  unit: SpeedUnit | undefined;
  formatTime: FormatTime | undefined;
  thresholds: SpeedThresholds | undefined;
};
