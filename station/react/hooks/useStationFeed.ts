"use client";
/* Poll a station feed. `url` is the MOUNT BASE (e.g. "/api/wind"); the hook
 * rides the shared createStationFeedStore, which requests `${url}/feed` and
 * owns the cadence rule (the fastest recommendedPollSeconds any station in
 * the last feed advised; 60 s before the first response) — the same store
 * the other bindings poll with, so no binding can drift on cadence or parse.
 *
 * initialData seeds state so an SSR page paints its server-fetched feed
 * immediately; the first client poll still fires on mount and refreshes it.
 * The seed is mount-time-only and belongs to the mount url — a url change
 * builds a fresh, empty store. servedAt rides inside the feed document; the
 * optional field here exists so a server can hand the pair through one prop
 * without unpacking the feed. fetchInit reaches the poll fetch (cache:
 * "no-store" for fast tiers, auth headers) at its LATEST value; the loop's
 * own abort signal always wins.
 *
 * error is structured: { kind: "network", status? } carries the HTTP status
 * when a response arrived; { kind: "contract", cause? } carries the zod
 * error (or JSON syntax error) behind an unreadable body. */
import { useMemo, useRef } from "react";
import { createStationFeedStore } from "../../client/index.js";
import type { PollError } from "../../client/index.js";
import type { StationFeed } from "../../index.js";
import { usePoller } from "./usePolledJson.js";

export function useStationFeed(
  url: string,
  options: {
    pollSeconds?: number;
    enabled?: boolean;
    fetchInit?: RequestInit;
    initialData?: { feed: StationFeed; servedAt?: string; receivedAtMs: number };
  } = {},
): {
  feed: StationFeed | null;
  error: PollError | null;
  receivedAtMs: number | null;
  refresh: () => void;
} {
  const { pollSeconds, enabled = true, fetchInit, initialData } = options;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  /* Mount-time values only: lazy refs run once, so a consumer mutating the
   * option later cannot rewind live state. */
  const initialRef = useRef(initialData);
  const mountUrlRef = useRef(url);

  const store = useMemo(
    () =>
      createStationFeedStore(url, {
        ...(pollSeconds != null ? { pollSeconds } : {}),
        fetchInit: () => fetchInitRef.current,
        ...(url === mountUrlRef.current && initialRef.current != null
          ? {
              initial: {
                feed: initialRef.current.feed,
                receivedAtMs: initialRef.current.receivedAtMs,
              },
            }
          : {}),
      }),
    [url, pollSeconds],
  );
  const { snapshot, refresh } = usePoller(store, enabled);
  return { feed: snapshot.data, error: snapshot.error, receivedAtMs: snapshot.receivedAtMs, refresh };
}
