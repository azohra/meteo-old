"use client";
/* One hook for the common page: poll the full feed AND the light current
 * endpoint for one station, fold them together with mergeCurrent, and hand
 * back the live document plus the station of interest.
 *
 * Named useStation — the package speaks Station* (StationFeed,
 * StationCurrent, useStationFeed, useStationCurrent), and this hook returns
 * a `station`; "useWindStation" would tie a data hook to one component's
 * name, and "useStationCard" names a UI shape the hook knows nothing about.
 *
 * `url` is the MOUNT BASE (e.g. "/api/wind"), exactly as on the two hooks it
 * composes. The current poll rides the station's own recommendedPollSeconds
 * (fast); the feed poll refreshes history at the fleet's advised cadence.
 *
 * The clock rule lives here so consumers never re-derive it: when the
 * current response merged, the pair is (merged feed, current receivedAtMs);
 * when merged is false — the current said unavailable, or named a station
 * absent from the feed — nothing advanced, so the feed keeps its OWN
 * receivedAtMs rather than crediting a dead station with a response it
 * never produced. */
import { useCallback, useMemo } from "react";
import type { Station, StationFeed } from "../../index.js";
import { mergeCurrent } from "../lib/mergeCurrent.js";
import type { PollError } from "./usePolledJson.js";
import { useStationCurrent } from "./useStationCurrent.js";
import { useStationFeed } from "./useStationFeed.js";

export function useStation(
  url: string,
  stationId: string,
  options: {
    /* Feed cadence override; the current endpoint keeps its own cadence. */
    pollSeconds?: number;
    /* Current-endpoint cadence override. */
    currentPollSeconds?: number;
    enabled?: boolean;
    fetchInit?: RequestInit;
    initialData?: { feed: StationFeed; receivedAtMs: number };
  } = {},
): {
  feed: StationFeed | null;
  station: Station | null;
  receivedAtMs: number | null;
  error: PollError | null;
  refresh: () => void;
} {
  const { pollSeconds, currentPollSeconds, enabled = true, fetchInit, initialData } = options;
  const feedResult = useStationFeed(url, {
    ...(pollSeconds != null ? { pollSeconds } : {}),
    enabled,
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initialData != null ? { initialData } : {}),
  });
  const currentResult = useStationCurrent(url, stationId, {
    ...(currentPollSeconds != null ? { pollSeconds: currentPollSeconds } : {}),
    enabled,
    ...(fetchInit != null ? { fetchInit } : {}),
  });

  const merged = useMemo(() => {
    if (feedResult.feed == null) {
      return { feed: null as StationFeed | null, receivedAtMs: null as number | null };
    }
    if (currentResult.current == null) {
      return { feed: feedResult.feed, receivedAtMs: feedResult.receivedAtMs };
    }
    const result = mergeCurrent(feedResult.feed, currentResult.current);
    return {
      feed: result.feed,
      /* The merged:false / keep-previous-receivedAtMs rule, applied. */
      receivedAtMs: result.merged ? currentResult.receivedAtMs : feedResult.receivedAtMs,
    };
  }, [feedResult.feed, feedResult.receivedAtMs, currentResult.current, currentResult.receivedAtMs]);

  const station = merged.feed?.stations.find((entry) => entry.id === stationId) ?? null;

  const feedRefresh = feedResult.refresh;
  const currentRefresh = currentResult.refresh;
  const refresh = useCallback(() => {
    feedRefresh();
    currentRefresh();
  }, [feedRefresh, currentRefresh]);

  return {
    feed: merged.feed,
    station,
    receivedAtMs: merged.receivedAtMs,
    /* The feed is the backbone; its error outranks the light endpoint's. */
    error: feedResult.error ?? currentResult.error,
    refresh,
  };
}
