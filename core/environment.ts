/* core/ — the repo-internal foundation capability siblings share.
 *
 * Convention: core/ has NO package.json export entry and never will. Sibling
 * capabilities (station/ today, future ones beside it) reach it via relative
 * imports only, and the build compiles it into dist/core so those relative
 * imports still resolve from the published dist tree. Anything a consumer
 * should reach is re-exported by a capability's public surface (for this
 * module, station/server re-exports everything here).
 *
 * Deliberately, core imports from no capability: the failure-reason
 * vocabulary below is defined here and the station wire contract's
 * UNAVAILABLE_REASONS is asserted (at compile time, in
 * station/server/environment.ts) to be a superset of it.
 *
 * This module is the world an adapter is allowed to touch, injected as plain
 * functions so the same code runs on Node, workers, Deno, and inside a test
 * with a stub fetch. No platform-specific cache or fetch options exist here:
 * caching is an explicit keyed store in front of every upstream, because at
 * least one known upstream (a Campbell logger on a non-standard port) is
 * refused by platform HTTP caches, and a cache that fronts only some
 * upstreams is a cache nobody can reason about. */

export type FeedCache = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
};

/* Stable machine discriminants for everything this library logs. Codes are
 * API: a consumer's alerting matches on code, never on message prose. */
export type LogEventCode =
  | "config_invalid"
  | "duplicate_station"
  | "upstream_failure"
  | "adapter_threw"
  | "custom_contract_break"
  | "clock_skew"
  | "resolver_invalid";

export type LogEvent = {
  level: "warn" | "error";
  /* The stable discriminant; message stays prose and may change wording. */
  code: LogEventCode;
  message: string;
  detail?: unknown;
};

export type ServerEnvironment = {
  fetch?: typeof fetch;
  cache?: FeedCache;
  logger?: (event: LogEvent) => void;
  userAgent?: string;
  now?: () => Date;
};

export type ResolvedEnvironment = Required<ServerEnvironment>;

export const UPSTREAM_FETCH_TIMEOUT_MS = 4_000;
/* Generous for every known station payload; anything past it is a
 * misbehaving feed, not a bigger station. */
export const UPSTREAM_RESPONSE_LIMIT_BYTES = 524_288;

/* The default cache must stay bounded: cache keys are caller-composed (a
 * requested history window rides in several), so an unbounded map is a slow
 * leak an operator only meets in production. */
const MEMORY_CACHE_MAX_ENTRIES = 500;

/* A TTL cache over a Map. Entries expire by wall clock, not by sweep, so an
 * idle key costs one stale slot until its next lookup evicts it. Bounded to
 * MEMORY_CACHE_MAX_ENTRIES with insertion-order (oldest-write-first) trim —
 * deliberately not true LRU: a re-put refreshes a key's position, a read
 * does not, and that is cheap and good enough for a polling workload. */
export function memoryCache(): FeedCache {
  const entries = new Map<string, { value: string; expiresAtMs: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() >= entry.expiresAtMs) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, ttlSeconds) {
      /* Delete-then-set moves a refreshed key to the end of insertion order
       * so the trim below always evicts the stalest write. */
      entries.delete(key);
      entries.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1_000 });
      while (entries.size > MEMORY_CACHE_MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

/* Module-level so bare adapter calls — no handler, no injected cache — still
 * coalesce their polling. Sharing is only as safe as the keys: every key must
 * name the upstream itself (vendor plus endpoint/station identity), never a
 * host-chosen label, or two handlers using the same label for different
 * upstreams cross-serve each other's payloads. */
const sharedDefaultCache = memoryCache();

/* Degradations must be visible somewhere by default: a feed that silently
 * swallows every upstream failure is indistinguishable from a healthy one.
 * Consumers with their own log pipeline inject a logger (a no-op silences). */
function consoleLogger(event: LogEvent): void {
  const log = event.level === "warn" ? console.warn : console.error;
  if (event.detail === undefined) {
    log(`[azohra-meteo] ${event.message}`);
  } else {
    log(`[azohra-meteo] ${event.message}`, event.detail);
  }
}

/* Identifies this library to upstreams honestly — several of them (WindNerd's
 * records endpoint above all) are unofficial, and an operator seeing traffic
 * should be able to find out what is polling. Override via
 * environment.userAgent. */
export const DEFAULT_USER_AGENT = "azohra-meteo/0.1 (+https://meteo.azohra.com)";

export function resolveEnvironment(environment: ServerEnvironment = {}): ResolvedEnvironment {
  return {
    fetch: environment.fetch ?? globalThis.fetch.bind(globalThis),
    cache: environment.cache ?? sharedDefaultCache,
    logger: environment.logger ?? consoleLogger,
    userAgent: environment.userAgent ?? DEFAULT_USER_AGENT,
    now: environment.now ?? (() => new Date()),
  };
}

/* The reason vocabulary a degrading upstream failure maps onto. Defined here
 * (not imported from a capability contract) so core stays capability-free;
 * the station wire contract's UNAVAILABLE_REASONS must remain a superset —
 * station/server/environment.ts asserts that at compile time. */
export const UPSTREAM_FAILURE_REASONS = [
  "upstream_error",
  "timeout",
  "rate_limited",
  "contract_break",
] as const;
export type UpstreamFailureReason = (typeof UPSTREAM_FAILURE_REASONS)[number];

/* The reasons an UpstreamError may be thrown WITH. contract_break is excluded
 * on purpose: nothing throws it — it is the mapper's verdict on a throw it
 * does not recognize (a parser escaped: the upstream answered but broke its
 * contract). */
export type UpstreamErrorReason = Exclude<UpstreamFailureReason, "contract_break">;

/* Failures carry their reason as a class, not prose parsing, so adapters can
 * map any thrown value onto the wire's reason codes. */
export class UpstreamError extends Error {
  readonly reason: UpstreamErrorReason;

  constructor(message: string, reason: UpstreamErrorReason = "upstream_error") {
    super(message);
    this.name = "UpstreamError";
    this.reason = reason;
  }
}

/* Everything an adapter throws lands in exactly one reason code: transport
 * failures are the upstream's fault, aborts are the clock's, and anything
 * else escaped a parser — the upstream answered but broke its contract. */
export function unavailableReasonForError(error: unknown): UpstreamFailureReason {
  if (error instanceof UpstreamError) return error.reason;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout";
  }
  /* fetch rejects network refusals as TypeError. */
  if (error instanceof TypeError) return "upstream_error";
  return "contract_break";
}

export type UpstreamTextRequest = {
  url: string | URL;
  /* Vendor/station-namespaced cache key. Never derived from the raw URL, so
   * a sliding time window in the query cannot defeat the cache. A non-GET
   * request caches under the same rules — the key must name the request's
   * semantics, or a POST's response shadows a GET's. */
  cacheKey: string;
  cacheTtlSeconds: number;
  /* Names the upstream in errors and logs. */
  subject: string;
  accept?: string;
  /* Merged OVER the default Accept/User-Agent pair — the caller wins. The
   * merge is a plain-object spread, so an override must use the defaults'
   * exact casing ("Accept", "User-Agent") to replace them. */
  headers?: Record<string, string>;
  /* Defaults to GET. */
  method?: string;
  body?: BodyInit;
  timeoutMs?: number;
  limitBytes?: number;
};

/* One in-flight load per (cache, key): N concurrent misses settle on a single
 * upstream hit. Keyed by cache identity, so the shared default cache
 * coalesces across bare adapter calls while an injected cache stays its
 * owner's. Entries clear on settle — a failure never wedges the key. */
const inFlightLoads = new WeakMap<FeedCache, Map<string, Promise<string>>>();

/**
 * The one road to an upstream: cache lookup, bounded fetch under a timeout,
 * cache fill. No fetch may hold a request open past the timeout and no
 * response may stream unbounded.
 *
 * Coalescing contract: at most one load is in flight per (cache instance,
 * cacheKey). Concurrent misses on the same key share the single in-flight
 * promise — including its rejection — and the slot clears when that promise
 * settles, so a failure never wedges the key and the next call retries the
 * upstream. Coalescing is scoped to the cache's identity: callers sharing
 * the default cache coalesce with each other; an injected cache coalesces
 * only among its own callers.
 */
export async function fetchUpstreamText(
  environment: ResolvedEnvironment,
  request: UpstreamTextRequest,
): Promise<string> {
  const cached = await environment.cache.get(request.cacheKey);
  if (cached != null) return cached;

  let pending = inFlightLoads.get(environment.cache);
  if (!pending) {
    pending = new Map();
    inFlightLoads.set(environment.cache, pending);
  }
  const inFlight = pending.get(request.cacheKey);
  if (inFlight) return inFlight;

  const settled = pending;
  const load = loadUpstreamText(environment, request).finally(() => {
    settled.delete(request.cacheKey);
  });
  pending.set(request.cacheKey, load);
  return load;
}

async function loadUpstreamText(
  environment: ResolvedEnvironment,
  request: UpstreamTextRequest,
): Promise<string> {
  let response: Response;
  try {
    response = await environment.fetch(request.url, {
      method: request.method,
      body: request.body,
      headers: {
        Accept: request.accept ?? "application/json",
        "User-Agent": environment.userAgent,
        ...request.headers,
      },
      signal: AbortSignal.timeout(request.timeoutMs ?? UPSTREAM_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new UpstreamError(`${request.subject} timed out`, "timeout");
    }
    throw new UpstreamError(
      `${request.subject} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    /* The body is abandoned, not read; cancel it so the connection is not
     * held open behind the thrown error. */
    try {
      await response.body?.cancel();
    } catch {
      /* Cancellation is best-effort. */
    }
    if (response.status === 429) {
      throw new UpstreamError(`${request.subject} is rate limiting requests`, "rate_limited");
    }
    throw new UpstreamError(`${request.subject} returned ${response.status}`);
  }

  const text = await boundedResponseText(
    response,
    request.limitBytes ?? UPSTREAM_RESPONSE_LIMIT_BYTES,
    request.subject,
  );
  await environment.cache.put(request.cacheKey, text, request.cacheTtlSeconds);
  return text;
}

export async function boundedResponseText(
  response: Response,
  limitBytes: number,
  subject: string,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new UpstreamError(`${subject} returned no body`);
  const decoder = new TextDecoder();
  let result = "";
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    totalBytes += value.byteLength;
    if (totalBytes > limitBytes) {
      await reader.cancel();
      throw new UpstreamError(`${subject} exceeded the response limit`);
    }
    result += decoder.decode(value, { stream: true });
  }
}

/* Feeds degrade, they don't reject — and every degradation logs through the
 * same shape (code "upstream_failure") so the tail is greppable. */
export function logUpstreamFailure(
  environment: ResolvedEnvironment,
  message: string,
  error: unknown,
  detail: Record<string, unknown> = {},
): void {
  environment.logger({
    level: "error",
    code: "upstream_failure",
    message,
    detail: {
      error: error instanceof Error ? error.message : String(error),
      ...detail,
    },
  });
}
