/* The poll loop shared by every binding, as a subscribe/getSnapshot store:
 * fetch immediately, then re-fetch on a timer whose interval the last
 * response may adjust. Framework-free and client-only at RUNTIME — the
 * module itself is import-safe anywhere (timers ride globalThis and the
 * document is feature-checked), so an SSR pass can import it and node tests
 * can drive it with fake timers.
 *
 * Semantics, owed to every caller identically:
 * - Visibility-gated: a hidden tab skips its ticks and refetches the moment
 *   it becomes visible again. No document (SSR, node) counts as visible.
 * - In-flight suppression: a slow response never stacks a second request.
 *   Every request carries an AbortController with a deadline, so a stalled
 *   request can never park the loop, and stop() cancels the request instead
 *   of orphaning it.
 * - The first timer waits for the first response, so the first interval
 *   honours the feed's advised cadence rather than the pre-data default.
 * - Keep-last-on-error: a failed or unreadable poll keeps the previous
 *   validated document and flags a structured error — the HTTP status on a
 *   non-ok response, the parse cause (a zod error, a JSON syntax error) on
 *   an unreadable body; an invalid body is a contract error, never a crash.
 * - An initial seed (SSR-fetched data handed to the client) fills the
 *   snapshot before the first fetch; the first poll still fires on start,
 *   because a seed is a starting point, never a substitute for refreshing.
 * - fetchInit rides every poll request (headers, credentials, cache mode);
 *   the loop's own AbortController signal is applied after it and wins.
 *
 * One rule deliberately lives with the CALLER: a url change is a new poller.
 * The react hooks key on the url and build a fresh, seed-less poller; the
 * elements provider does the same on attribute change — so "a url change
 * drops the held document" holds in every binding by construction. */

/* Structured so a consumer can distinguish a 401 from a dead network and can
 * log the zod issues behind a contract break. */
export type PollError =
  | { kind: "network"; status?: number }
  | { kind: "contract"; cause?: unknown };

/* What a parse hands back: the validated document, or the reason it is not
 * one (threaded into the contract error's `cause`). */
export type ParseOutcome<T> = { ok: true; data: T } | { ok: false; cause: unknown };

export type PollSeed<T> = { data: T; receivedAtMs: number };

export type PollSnapshot<T> = {
  data: T | null;
  error: PollError | null;
  receivedAtMs: number | null;
};

/* A response slower than this is a dead upstream, not a slow one. */
export const REQUEST_TIMEOUT_MS = 15_000;

/* The shared between-polls re-judgment cadence: freshness badges and ticking
 * relative ages re-evaluate on this clock in every binding. */
export const FRESHNESS_REEVALUATE_MS = 30_000;

export type JsonPollerOptions<T> = {
  parse: (text: string) => ParseOutcome<T>;
  intervalMsFor: (last: T | null) => number;
  /* A plain init, or a function read per request so a caller can thread its
   * LATEST init without restarting the loop. */
  fetchInit?: RequestInit | (() => RequestInit | undefined);
  initial?: PollSeed<T>;
};

export type JsonPoller<T> = {
  /* Stable object identity between changes — useSyncExternalStore-ready. */
  getSnapshot(): PollSnapshot<T>;
  subscribe(listener: () => void): () => void;
  /* Idempotent: fetches immediately, then loops. */
  start(): void;
  /* Aborts any in-flight request and clears the timer; the snapshot holds. */
  stop(): void;
  /* Restart the loop NOW, keeping the held snapshot. A no-op while stopped. */
  refresh(): void;
};

type Loop = {
  disposed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  controller: AbortController | null;
  inFlight: boolean;
  onVisibilityChange: () => void;
};

export function createJsonPoller<T>(url: string, options: JsonPollerOptions<T>): JsonPoller<T> {
  const { parse, intervalMsFor, initial } = options;
  const fetchInitFor = (): RequestInit | undefined =>
    typeof options.fetchInit === "function" ? options.fetchInit() : options.fetchInit;

  let snapshot: PollSnapshot<T> =
    initial != null
      ? { data: initial.data, error: null, receivedAtMs: initial.receivedAtMs }
      : { data: null, error: null, receivedAtMs: null };
  const listeners = new Set<() => void>();
  let loop: Loop | null = null;

  const setSnapshot = (next: PollSnapshot<T>) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const hidden = () => typeof document !== "undefined" && document.hidden;

  const run = async (current: Loop): Promise<void> => {
    if (current.inFlight) return;
    current.inFlight = true;
    const requestController = new AbortController();
    current.controller = requestController;
    const deadline = setTimeout(() => requestController.abort(), REQUEST_TIMEOUT_MS);
    try {
      /* Consumer init first, signal last: the loop's abort must win over
       * any signal the consumer supplied. */
      const response = await fetch(url, {
        ...fetchInitFor(),
        signal: requestController.signal,
      });
      const body = await response.text();
      if (current.disposed) return;
      if (!response.ok) {
        setSnapshot({ ...snapshot, error: { kind: "network", status: response.status } });
        return;
      }
      const parsed = parse(body);
      if (!parsed.ok) {
        setSnapshot({ ...snapshot, error: { kind: "contract", cause: parsed.cause } });
        return;
      }
      setSnapshot({ data: parsed.data, error: null, receivedAtMs: Date.now() });
    } catch {
      /* Abort (deadline or stop) and network failure land here — no HTTP
       * status exists to report; after stop no snapshot may be written. */
      if (!current.disposed) setSnapshot({ ...snapshot, error: { kind: "network" } });
    } finally {
      clearTimeout(deadline);
      if (current.controller === requestController) current.controller = null;
      current.inFlight = false;
    }
  };

  const schedule = (current: Loop) => {
    current.timer = setTimeout(async () => {
      if (!hidden()) await run(current);
      if (!current.disposed) schedule(current);
    }, intervalMsFor(snapshot.data));
  };

  const start = () => {
    if (loop != null) return;
    const current: Loop = {
      disposed: false,
      timer: undefined,
      controller: null,
      inFlight: false,
      onVisibilityChange: () => {
        if (!hidden()) void run(current);
      },
    };
    loop = current;
    /* run never rejects; schedule after it settles so the first interval is
     * computed from the first response. */
    void run(current).then(() => {
      if (!current.disposed) schedule(current);
    });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", current.onVisibilityChange);
    }
  };

  const stop = () => {
    const current = loop;
    if (current == null) return;
    loop = null;
    current.disposed = true;
    current.controller?.abort();
    if (current.timer != null) clearTimeout(current.timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", current.onVisibilityChange);
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    stop,
    refresh: () => {
      if (loop == null) return;
      stop();
      start();
    },
  };
}
