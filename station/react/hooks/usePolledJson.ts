"use client";
/* The react shell over the framework-free poll loop
 * (station/client/poll.ts): one poller per url, subscribed through
 * useSyncExternalStore, started and stopped by an effect. Every loop
 * semantic — visibility gating, in-flight suppression, the
 * first-interval-after-first-response rule, keep-last-on-error, the abort
 * deadline — lives in createJsonPoller, where the other bindings share it.
 *
 * What is react's here:
 * - A url change is a NEW poller, constructed empty — so the old document is
 *   dropped rather than served under the new address — and the seed applies
 *   only to the mount-time url: lazy refs run once, so a consumer mutating
 *   the option later cannot rewind live state.
 * - Latest callbacks (parse, intervalMsFor, fetchInit) ride refs so a
 *   consumer passing fresh literals every render never restarts the loop.
 * - getServerSnapshot returns the same seed-or-empty snapshot, so an SSR
 *   pass renders the seed and hydration sees exactly what the server saw. */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createJsonPoller } from "../../client/index.js";
import type { ParseOutcome, PollError, PollSeed } from "../../client/index.js";

type PolledState<T> = {
  data: T | null;
  error: PollError | null;
  receivedAtMs: number | null;
};

/* The lifecycle every store-backed hook shares: subscribe through
 * useSyncExternalStore (getServerSnapshot = the same seed-or-empty snapshot,
 * so SSR renders the seed), start/stop from an effect (idempotent, so
 * StrictMode's double effect is absorbed), refresh delegated. Internal to
 * the react binding — useStationFeed and useStationCurrent ride it over the
 * shared station stores. */
export function usePoller<S>(
  poller: {
    getSnapshot(): S;
    subscribe(listener: () => void): () => void;
    start(): void;
    stop(): void;
    refresh(): void;
  },
  enabled: boolean,
): { snapshot: S; refresh: () => void } {
  const snapshot = useSyncExternalStore(poller.subscribe, poller.getSnapshot, poller.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    poller.start();
    return () => poller.stop();
  }, [poller, enabled]);
  const refresh = useCallback(() => poller.refresh(), [poller]);
  return { snapshot, refresh };
}

export function usePolledJson<T>(
  url: string,
  parse: (text: string) => ParseOutcome<T>,
  intervalMsFor: (last: T | null) => number,
  enabled: boolean,
  fetchInit?: RequestInit,
  initial?: PollSeed<T>,
): PolledState<T> & { refresh: () => void } {
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const intervalRef = useRef(intervalMsFor);
  intervalRef.current = intervalMsFor;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  /* Mount-time values only: the seed belongs to the url the hook mounted
   * with, never to an address the consumer later navigated the hook to. */
  const initialRef = useRef(initial);
  const mountUrlRef = useRef(url);

  const poller = useMemo(
    () =>
      createJsonPoller<T>(url, {
        parse: (text) => parseRef.current(text),
        intervalMsFor: (last) => intervalRef.current(last),
        fetchInit: () => fetchInitRef.current,
        ...(url === mountUrlRef.current && initialRef.current != null
          ? { initial: initialRef.current }
          : {}),
      }),
    [url],
  );

  const { snapshot, refresh } = usePoller(poller, enabled);
  return { ...snapshot, refresh };
}
