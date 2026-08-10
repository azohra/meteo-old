"use client";
/* The poll loop shared by useStationFeed and useStationCurrent: fetch immediately,
 * then re-fetch on a timer whose interval the last response may adjust.
 *
 * - Visibility-gated: a hidden tab skips its ticks and refetches the moment
 *   it becomes visible again.
 * - In-flight suppression: a slow response never stacks a second request.
 *   The flag is effect-scoped and every request carries an AbortController
 *   with a deadline, so a stalled request can never park the loop and a url
 *   change or unmount cancels the request instead of orphaning it.
 * - The first timer waits for the first response, so the first interval
 *   honours the feed's advised cadence rather than the pre-data default.
 * - Keep-last-on-error: a failed or unreadable poll keeps the previous
 *   validated document and flags a structured error — the HTTP status on a
 *   non-ok response, the parse cause (a zod error, a JSON syntax error) on an
 *   unreadable body; an invalid body is a contract error, never a crash.
 * - An initial seed (SSR-fetched data handed to the client) fills state
 *   before the first fetch; the first poll still fires on mount, because a
 *   seed is a starting point, never a substitute for refreshing.
 * - fetchInit rides every poll request (headers, credentials, cache mode);
 *   the loop's own AbortController signal is applied after it and wins. */
import { useCallback, useEffect, useRef, useState } from "react";

/* Structured so a consumer can distinguish a 401 from a dead network and can
 * log the zod issues behind a contract break. */
export type PollError =
  | { kind: "network"; status?: number }
  | { kind: "contract"; cause?: unknown };

/* What a parse hands back: the validated document, or the reason it is not
 * one (threaded into the contract error's `cause`). */
export type ParseOutcome<T> = { ok: true; data: T } | { ok: false; cause: unknown };

/* A response slower than this is a dead upstream, not a slow one. */
const REQUEST_TIMEOUT_MS = 15_000;

type PolledState<T> = {
  data: T | null;
  error: PollError | null;
  receivedAtMs: number | null;
};

export type PollSeed<T> = { data: T; receivedAtMs: number };

export function usePolledJson<T>(
  url: string,
  parse: (text: string) => ParseOutcome<T>,
  intervalMsFor: (last: T | null) => number,
  enabled: boolean,
  fetchInit?: RequestInit,
  initial?: PollSeed<T>,
): PolledState<T> & { refresh: () => void } {
  /* The seed is a mount-time value only: lazy initializers run once, so a
   * consumer mutating the option later cannot rewind live state. */
  const [state, setState] = useState<PolledState<T>>(() =>
    initial != null
      ? { data: initial.data, error: null, receivedAtMs: initial.receivedAtMs }
      : { data: null, error: null, receivedAtMs: null },
  );
  /* Refs so the effect can close over stable identities: dataRef feeds the
   * interval calculation, and the latest callbacks ride along without
   * restarting the loop on every render. */
  const dataRef = useRef<T | null>(initial?.data ?? null);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const intervalRef = useRef(intervalMsFor);
  intervalRef.current = intervalMsFor;
  /* Latest fetchInit without restarting the loop: a consumer passing a fresh
   * object literal every render must not retrigger the effect. */
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  /* Which url the held document came from: a url change must drop the old
   * document rather than serve it under the new address. */
  const dataUrlRef = useRef(url);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (dataUrlRef.current !== url) {
      dataUrlRef.current = url;
      dataRef.current = null;
      setState({ data: null, error: null, receivedAtMs: null });
    }
    let disposed = false;
    let timer: number | undefined;
    /* Effect-scoped: an aborted predecessor cannot suppress this loop's
     * first fetch. */
    let inFlight = false;
    let controller: AbortController | null = null;

    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      const requestController = new AbortController();
      controller = requestController;
      const deadline = window.setTimeout(
        () => requestController.abort(),
        REQUEST_TIMEOUT_MS,
      );
      try {
        /* Consumer init first, signal last: the loop's abort must win over
         * any signal the consumer supplied. */
        const response = await fetch(url, {
          ...fetchInitRef.current,
          signal: requestController.signal,
        });
        const body = await response.text();
        if (disposed) return;
        if (!response.ok) {
          const status = response.status;
          setState((previous) => ({ ...previous, error: { kind: "network", status } }));
          return;
        }
        const parsed = parseRef.current(body);
        if (!parsed.ok) {
          setState((previous) => ({
            ...previous,
            error: { kind: "contract", cause: parsed.cause },
          }));
          return;
        }
        dataRef.current = parsed.data;
        setState({ data: parsed.data, error: null, receivedAtMs: Date.now() });
      } catch {
        /* Abort (deadline or cleanup) and network failure land here — no HTTP
         * status exists to report; after unmount or url change no state may
         * be written. */
        if (!disposed) setState((previous) => ({ ...previous, error: { kind: "network" } }));
      } finally {
        window.clearTimeout(deadline);
        if (controller === requestController) controller = null;
        inFlight = false;
      }
    };

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (!document.hidden) await run();
        if (!disposed) schedule();
      }, intervalRef.current(dataRef.current));
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void run();
    };

    /* run never rejects; schedule after it settles so the first interval is
     * computed from the first response. */
    void run().then(() => {
      if (!disposed) schedule();
    });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      controller?.abort();
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [url, enabled, epoch]);

  const refresh = useCallback(() => setEpoch((count) => count + 1), []);
  return { ...state, refresh };
}
