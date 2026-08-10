"use client";
/* Poll the light current endpoint for one station — the fast companion to
 * useStationFeed's full document. `url` is the MOUNT BASE (e.g. "/api/wind"),
 * the same argument useStationFeed takes; the hook rides the shared
 * createStationCurrentStore, which requests `${url}/current?station=<id>`
 * and owns the cadence rule (the station's own recommendedPollSeconds once
 * a response has arrived; 15 s before then, because this endpoint exists to
 * be quick). Merge the parts into the full feed with mergeCurrent — or let
 * useStation do the whole dance.
 *
 * initialData seeds state exactly as on useStationFeed: the seeded document
 * paints before any fetch, and the first poll still fires on mount.
 * fetchInit rides every poll at its LATEST value (cache: "no-store" is the
 * usual passenger here — a fast tier must defeat browser HTTP caching); the
 * loop's abort wins. error is structured exactly as on useStationFeed. */
import { useMemo, useRef } from "react";
import { createStationCurrentStore } from "../../client/index.js";
import type { PollError } from "../../client/index.js";
import type { Station, StationCurrent } from "../../index.js";
import { usePoller } from "./usePolledJson.js";

export function useStationCurrent(
  url: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    enabled?: boolean;
    fetchInit?: RequestInit;
    initialData?: { current: StationCurrent; receivedAtMs: number };
  } = {},
): {
  current: StationCurrent | null;
  station: Station | null;
  servedAt: string | null;
  error: PollError | null;
  receivedAtMs: number | null;
  refresh: () => void;
} {
  const { pollSeconds, enabled = true, fetchInit, initialData } = options;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  /* Mount-time values only, owned by the mount address: a url or station
   * change builds a fresh, empty store. */
  const initialRef = useRef(initialData);
  const mountUrlRef = useRef(url);
  const mountStationRef = useRef(stationId);

  const store = useMemo(
    () =>
      createStationCurrentStore(url, stationId, {
        ...(pollSeconds != null ? { pollSeconds } : {}),
        fetchInit: () => fetchInitRef.current,
        ...(url === mountUrlRef.current &&
        stationId === mountStationRef.current &&
        initialRef.current != null
          ? { initial: initialRef.current }
          : {}),
      }),
    [url, stationId, pollSeconds],
  );
  const { snapshot, refresh } = usePoller(store, enabled);
  return {
    current: snapshot.data,
    station: snapshot.data?.station ?? null,
    servedAt: snapshot.data?.servedAt ?? null,
    error: snapshot.error,
    receivedAtMs: snapshot.receivedAtMs,
    refresh,
  };
}
