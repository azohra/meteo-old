"use client";
/* Poll the light current endpoint for one station — the fast companion to
 * useStationFeed's full document. `url` is the MOUNT BASE (e.g. "/api/wind"),
 * the same argument useStationFeed takes; the hook requests
 * `${url}/current?station=<id>`. Cadence follows the station's own
 * recommendedPollSeconds once a response has arrived; 15 s before then,
 * because this endpoint exists to be quick. Merge the parts into the full
 * feed with mergeCurrent — or let useStation do the whole dance.
 *
 * initialData seeds state exactly as on useStationFeed: the seeded document
 * paints before any fetch, and the first poll still fires on mount.
 * fetchInit rides every poll (cache: "no-store" is the usual passenger here
 * — a fast tier must defeat browser HTTP caching); the loop's abort wins.
 * error is structured exactly as on useStationFeed. */
import { stationCurrentSchema } from "../../index.js";
import type { Station, StationCurrent } from "../../index.js";
import { currentEndpoint } from "./endpoints.js";
import { usePolledJson } from "./usePolledJson.js";
import type { ParseOutcome, PollError } from "./usePolledJson.js";

const DEFAULT_POLL_SECONDS = 15;

/* safeParse so the zod issues (or JSON syntax error) thread into the
 * contract error's cause. */
function parseCurrentText(text: string): ParseOutcome<StationCurrent> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, cause };
  }
  const result = stationCurrentSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, cause: result.error };
}

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
  const { data, error, receivedAtMs, refresh } = usePolledJson(
    currentEndpoint(url, stationId),
    parseCurrentText,
    (last) =>
      (pollSeconds ?? last?.station.recommendedPollSeconds ?? DEFAULT_POLL_SECONDS) * 1_000,
    enabled,
    fetchInit,
    initialData == null
      ? undefined
      : { data: initialData.current, receivedAtMs: initialData.receivedAtMs },
  );
  return {
    current: data,
    station: data?.station ?? null,
    servedAt: data?.servedAt ?? null,
    error,
    receivedAtMs,
    refresh,
  };
}
