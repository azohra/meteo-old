/* Client-side data layer: the poll loop and the station stores every binding
 * subscribes to. Framework-free, and client-only at RUNTIME — importing this
 * module is safe anywhere (SSR passes, node tests), but its loops touch
 * fetch, timers, and page visibility, so they only ever RUN in a browser (or
 * a test driving those globals). The mirror of "@azohra/meteo/station/server":
 * one subpath per side of the wire, neither reachable from the isomorphic
 * root by accident. */
export {
  FRESHNESS_REEVALUATE_MS,
  REQUEST_TIMEOUT_MS,
  createJsonPoller,
} from "./poll.js";
export type {
  JsonPoller,
  JsonPollerOptions,
  ParseOutcome,
  PollError,
  PollSeed,
  PollSnapshot,
} from "./poll.js";
export {
  createStationCurrentStore,
  createStationFeedStore,
  createStationStore,
  parseCurrentText,
  parseFeedText,
} from "./stores.js";
export type { StationSnapshot, StationStore } from "./stores.js";
