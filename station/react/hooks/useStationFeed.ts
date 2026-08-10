"use client";
/* Poll a station feed. `url` is the MOUNT BASE (e.g. "/api/wind"); the hook
 * requests `${url}/feed` — the same convention as useStationCurrent and
 * useStation, mirroring the handler's pathname-suffix routing. Cadence
 * defaults to the fastest recommendedPollSeconds any station in the last
 * feed advised, so the client honours upstream cache honesty without
 * configuration; 60 s before the first response arrives.
 *
 * initialData seeds state so an SSR page paints its server-fetched feed
 * immediately; the first client poll still fires on mount and refreshes it.
 * servedAt rides inside the feed document; the optional field here exists so
 * a server can hand the pair through one prop without unpacking the feed.
 * fetchInit reaches the poll fetch (cache: "no-store" for fast tiers, auth
 * headers); the loop's own abort signal always wins.
 *
 * error is structured: { kind: "network", status? } carries the HTTP status
 * when a response arrived; { kind: "contract", cause? } carries the zod
 * error (or JSON syntax error) behind an unreadable body. */
import { stationFeedSchema } from "../../index.js";
import type { StationFeed } from "../../index.js";
import { feedEndpoint } from "./endpoints.js";
import { usePolledJson } from "./usePolledJson.js";
import type { ParseOutcome, PollError } from "./usePolledJson.js";

const DEFAULT_POLL_SECONDS = 60;

/* safeParse instead of the null-returning parseStationFeedJson: the zod
 * issues (or the JSON syntax error) thread into the contract error. */
function parseFeedText(text: string): ParseOutcome<StationFeed> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, cause };
  }
  const result = stationFeedSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, cause: result.error };
}

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
  const { data, error, receivedAtMs, refresh } = usePolledJson(
    feedEndpoint(url),
    parseFeedText,
    (last) => {
      if (pollSeconds != null) return pollSeconds * 1_000;
      const advised = last?.stations.map((station) => station.recommendedPollSeconds) ?? [];
      return (advised.length > 0 ? Math.min(...advised) : DEFAULT_POLL_SECONDS) * 1_000;
    },
    enabled,
    fetchInit,
    initialData == null
      ? undefined
      : { data: initialData.feed, receivedAtMs: initialData.receivedAtMs },
  );
  return { feed: data, error, receivedAtMs, refresh };
}
