/* The station data layer over createJsonPoller, so the cadence, parse, and
 * merge rules exist exactly once for every binding: the feed store polls the
 * full document at the fleet's advised cadence, the current store polls the
 * light endpoint at the station's own, and the station store composes the
 * two with mergeCurrent's clock rule. `base` is always the MOUNT BASE
 * (e.g. "/api/wind") — the endpoints module builds the routes. */
import { stationCurrentSchema, stationFeedSchema } from "../contract.js";
import type { Station, StationCurrent, StationFeed } from "../contract.js";
import { currentEndpoint, feedEndpoint } from "../endpoints.js";
import { foldCurrent } from "../mergeCurrent.js";
import { createJsonPoller } from "./poll.js";
import type { JsonPoller, ParseOutcome, PollError } from "./poll.js";

const FEED_DEFAULT_POLL_SECONDS = 60;
/* The current endpoint exists to be quick. */
const CURRENT_DEFAULT_POLL_SECONDS = 15;

/* safeParse instead of the null-returning parse helpers: the zod issues (or
 * the JSON syntax error) thread into the contract error's cause. */
export function parseFeedText(text: string): ParseOutcome<StationFeed> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, cause };
  }
  const result = stationFeedSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, cause: result.error };
}

export function parseCurrentText(text: string): ParseOutcome<StationCurrent> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, cause };
  }
  const result = stationCurrentSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, cause: result.error };
}

type FetchInitOption = RequestInit | (() => RequestInit | undefined);

/* Cadence defaults to the fastest recommendedPollSeconds any station in the
 * last feed advised, so the client honours upstream cache honesty without
 * configuration; 60 s before the first response arrives. */
export function createStationFeedStore(
  base: string,
  options: {
    pollSeconds?: number;
    fetchInit?: FetchInitOption;
    initial?: { feed: StationFeed; receivedAtMs: number };
  } = {},
): JsonPoller<StationFeed> {
  const { pollSeconds, fetchInit, initial } = options;
  return createJsonPoller(feedEndpoint(base), {
    parse: parseFeedText,
    intervalMsFor: (last) => {
      if (pollSeconds != null) return pollSeconds * 1_000;
      const advised = last?.stations.map((station) => station.recommendedPollSeconds) ?? [];
      return (advised.length > 0 ? Math.min(...advised) : FEED_DEFAULT_POLL_SECONDS) * 1_000;
    },
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initial != null ? { initial: { data: initial.feed, receivedAtMs: initial.receivedAtMs } } : {}),
  });
}

/* Cadence follows the station's own recommendedPollSeconds once a response
 * has arrived; 15 s before then. */
export function createStationCurrentStore(
  base: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    fetchInit?: FetchInitOption;
    initial?: { current: StationCurrent; receivedAtMs: number };
  } = {},
): JsonPoller<StationCurrent> {
  const { pollSeconds, fetchInit, initial } = options;
  return createJsonPoller(currentEndpoint(base, stationId), {
    parse: parseCurrentText,
    intervalMsFor: (last) =>
      (pollSeconds ?? last?.station.recommendedPollSeconds ?? CURRENT_DEFAULT_POLL_SECONDS) * 1_000,
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initial != null
      ? { initial: { data: initial.current, receivedAtMs: initial.receivedAtMs } }
      : {}),
  });
}

export type StationSnapshot = {
  feed: StationFeed | null;
  station: Station | null;
  receivedAtMs: number | null;
  error: PollError | null;
};

export type StationStore = {
  /* Stable object identity between underlying changes. */
  getSnapshot(): StationSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): void;
};

/* Poll the full feed AND the light current endpoint for one station, folded
 * together with mergeCurrent and its clock rule (merged → the current's
 * receivedAtMs; not merged → the feed keeps its own — never credit a dead
 * station with a response it never produced). The feed is the backbone; its
 * error outranks the light endpoint's. */
export function createStationStore(
  base: string,
  stationId: string,
  options: {
    /* Feed cadence override; the current endpoint keeps its own cadence. */
    pollSeconds?: number;
    /* Current-endpoint cadence override. */
    currentPollSeconds?: number;
    fetchInit?: FetchInitOption;
    initialData?: { feed: StationFeed; receivedAtMs: number };
  } = {},
): StationStore {
  const { pollSeconds, currentPollSeconds, fetchInit, initialData } = options;
  const feedStore = createStationFeedStore(base, {
    ...(pollSeconds != null ? { pollSeconds } : {}),
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initialData != null ? { initial: initialData } : {}),
  });
  const currentStore = createStationCurrentStore(base, stationId, {
    ...(currentPollSeconds != null ? { pollSeconds: currentPollSeconds } : {}),
    ...(fetchInit != null ? { fetchInit } : {}),
  });

  /* Lazily recomputed, cached against the underlying snapshots, so
   * getSnapshot is referentially stable between changes. */
  let cached: StationSnapshot | null = null;
  let lastFeed: ReturnType<typeof feedStore.getSnapshot> | null = null;
  let lastCurrent: ReturnType<typeof currentStore.getSnapshot> | null = null;

  return {
    getSnapshot: () => {
      const feedSnapshot = feedStore.getSnapshot();
      const currentSnapshot = currentStore.getSnapshot();
      if (cached == null || feedSnapshot !== lastFeed || currentSnapshot !== lastCurrent) {
        lastFeed = feedSnapshot;
        lastCurrent = currentSnapshot;
        const folded = foldCurrent(
          feedSnapshot.data,
          feedSnapshot.receivedAtMs,
          currentSnapshot.data,
          currentSnapshot.receivedAtMs,
        );
        cached = {
          feed: folded.feed,
          station: folded.feed?.stations.find((entry) => entry.id === stationId) ?? null,
          receivedAtMs: folded.receivedAtMs,
          error: feedSnapshot.error ?? currentSnapshot.error,
        };
      }
      return cached;
    },
    subscribe: (listener) => {
      const unsubscribeFeed = feedStore.subscribe(listener);
      const unsubscribeCurrent = currentStore.subscribe(listener);
      return () => {
        unsubscribeFeed();
        unsubscribeCurrent();
      };
    },
    start: () => {
      feedStore.start();
      currentStore.start();
    },
    stop: () => {
      feedStore.stop();
      currentStore.stop();
    },
    refresh: () => {
      feedStore.refresh();
      currentStore.refresh();
    },
  };
}
