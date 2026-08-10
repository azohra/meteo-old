/* The mountable feed handler: web-standard Request in, Response out, so the
 * same function serves from Node, workers, Deno, or a framework route.
 *
 * Capability-handler routing convention: a capability handler owns a small
 * set of leaf routes ("/feed" and "/current" here) under a mount point that
 * belongs to the host app. By default it matches by pathname SUFFIX, so it
 * can sit behind any framework prefix without configuration; a host mounting
 * several capability handlers beside each other passes basePath, which
 * switches to exact matching (basePath + "/feed") so one capability's suffix
 * can never shadow a sibling's.
 *
 * All data work lives in loadStationFeed/loadStationCurrent; this layer owns
 * only HTTP: routing, CORS, ?hours= validation, Cache-Control, and ETag/304. */
import type { StationCurrent, StationFeed } from "../contract.js";
import {
  DEFAULT_HISTORY_HOURS,
  UnknownStationError,
  assembleStations,
  loadStationCurrent,
  loadStationFeed,
  type StationsInput,
} from "./feed.js";
import { resolveEnvironment, type ServerEnvironment } from "./environment.js";

export type StationFeedHandlerRoute = "feed" | "current";

const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

export type StationFeedHandlerOptions = {
  stations: StationsInput;
  primaryStationId?: string;
  /* The construction-time history window: both the default and the ceiling
   * ?hours= clamps to, so a client cannot request a heavier backfill than
   * the host chose. */
  maxHistoryHours?: number;
  /* Pins routing to an exact mount (basePath + "/feed", + "/current");
   * absent, routes match by pathname suffix — see the convention above. */
  basePath?: string;
  /* true serves "*"; a string serves that origin verbatim. */
  cors?: boolean | string;
  /* Overrides the default `public, max-age=N` (N = the honest poll cadence).
   * Use the callback form for CDN directives, e.g.
   * (route, maxAge) => `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=30`. */
  cacheControl?: string | ((route: StationFeedHandlerRoute, maxAgeSeconds: number) => string);
  environment?: ServerEnvironment;
};

export type StationFeedHandler = (request: Request) => Promise<Response>;

export function createStationFeedHandler(options: StationFeedHandlerOptions): StationFeedHandler {
  const environment = resolveEnvironment(options.environment);
  /* A static array can be checked now, loudly: every invalid entry warns at
   * construction instead of surprising the first request. Nothing throws —
   * per-request assembly degrades the bad station and serves the rest. */
  if (Array.isArray(options.stations)) assembleStations(options.stations, environment);
  const maxHistoryHours = options.maxHistoryHours ?? DEFAULT_HISTORY_HOURS;
  /* One trailing slash on a configured basePath is the same routing noise a
   * request path sheds below. */
  const basePath = options.basePath?.endsWith("/")
    ? options.basePath.slice(0, -1)
    : options.basePath;
  const corsOrigin =
    options.cors === true ? "*" : typeof options.cors === "string" ? options.cors : null;

  const baseHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (corsOrigin) {
      headers["Access-Control-Allow-Origin"] = corsOrigin;
      if (corsOrigin !== "*") headers["Vary"] = "Origin";
    }
    return headers;
  };

  const cacheControlFor = (route: StationFeedHandlerRoute, maxAgeSeconds: number): string =>
    typeof options.cacheControl === "function"
      ? options.cacheControl(route, maxAgeSeconds)
      : (options.cacheControl ?? `public, max-age=${Math.round(maxAgeSeconds)}`);

  const json = (body: unknown, status: number, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...baseHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        ...extraHeaders,
      },
    });

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS" && corsOrigin) {
      return new Response(null, {
        status: 204,
        headers: {
          ...baseHeaders(),
          "Access-Control-Allow-Methods": ALLOWED_METHODS,
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    /* HEAD is GET without the body: same status, same headers (RFC 9110). */
    const isHead = request.method === "HEAD";
    if (request.method !== "GET" && !isHead) {
      /* 405 must name what IS allowed (RFC 9110 §15.5.6). */
      return json({ error: "method not allowed" }, 405, { Allow: ALLOWED_METHODS });
    }
    const respond = (
      body: unknown,
      status: number,
      extraHeaders: Record<string, string> = {},
    ): Response => {
      const response = json(body, status, extraHeaders);
      return isHead
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    };
    const notModified = (extraHeaders: Record<string, string>): Response =>
      new Response(null, { status: 304, headers: { ...baseHeaders(), ...extraHeaders } });

    const url = new URL(request.url);
    /* One trailing slash is routing noise; more than one is a different path. */
    const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    const route: StationFeedHandlerRoute | null =
      basePath != null
        ? pathname === `${basePath}/feed`
          ? "feed"
          : pathname === `${basePath}/current`
            ? "current"
            : null
        : pathname.endsWith("/feed")
          ? "feed"
          : pathname.endsWith("/current")
            ? "current"
            : null;
    if (!route) return respond({ error: "not found" }, 404);

    const hours = parseHoursParam(url, maxHistoryHours);
    if (hours == null) {
      return respond(
        { error: `invalid hours: expected a number in (0, ${maxHistoryHours}]` },
        400,
      );
    }
    const loadOptions = {
      stations: options.stations,
      primaryStationId: options.primaryStationId,
      historyHours: hours,
      maxHistoryHours,
      environment: options.environment,
      request,
    };

    if (route === "feed") {
      const feed: StationFeed = await loadStationFeed(loadOptions);
      /* The fastest station's honest cadence; 60 s only when the feed is
       * empty and there is no cadence to honour. */
      const maxAge =
        feed.stations.length === 0
          ? 60
          : feed.stations.reduce(
              (least, station) => Math.min(least, station.recommendedPollSeconds),
              Infinity,
            );
      const headers = {
        "Cache-Control": cacheControlFor("feed", maxAge),
        /* servedAt changes every response by design; the ETag hashes what a
         * client actually renders, so unchanged upstreams revalidate free. */
        ETag: weakEtag({
          schemaVersion: feed.schemaVersion,
          primaryStationId: feed.primaryStationId,
          stations: feed.stations,
        }),
      };
      if (etagMatches(request.headers.get("If-None-Match"), headers.ETag)) {
        return notModified(headers);
      }
      return respond(feed, 200, headers);
    }

    const stationId = url.searchParams.get("station");
    /* A request that forgot the parameter is malformed (400); only a
     * well-formed id that matches no station is 404. */
    if (!stationId) return respond({ error: "missing station parameter" }, 400);
    let current: StationCurrent;
    try {
      current = await loadStationCurrent({ ...loadOptions, stationId });
    } catch (error) {
      if (error instanceof UnknownStationError) {
        return respond({ error: "unknown station" }, 404);
      }
      throw error;
    }
    const headers = {
      "Cache-Control": cacheControlFor("current", current.station.recommendedPollSeconds),
      ETag: weakEtag({ schemaVersion: current.schemaVersion, station: current.station }),
    };
    if (etagMatches(request.headers.get("If-None-Match"), headers.ETag)) {
      return notModified(headers);
    }
    return respond(current, 200, headers);
  };
}

/* ?hours= grid: quarter-hour steps. Adapters key upstream cache entries by
 * the requested window, so quantizing bounds the distinct keys a client can
 * mint to ceiling/0.25 — without it, every float in (0, ceiling] is its own
 * cache entry. */
const HOURS_STEP = 0.25;

/* ?hours= — a float in (0, ceiling]. Absent means the ceiling; anything out
 * of range or unparseable is null, which the handler turns into 400. A valid
 * value is then quantized to the quarter-hour grid and clamped back into
 * [step, ceiling]. */
function parseHoursParam(url: URL, ceiling: number): number | null {
  const raw = url.searchParams.get("hours");
  if (raw == null) return ceiling;
  const value = Number(raw.trim() === "" ? Number.NaN : raw);
  if (!Number.isFinite(value) || value <= 0 || value > ceiling) return null;
  const quantized = Math.round(value / HOURS_STEP) * HOURS_STEP;
  return Math.min(ceiling, Math.max(HOURS_STEP, quantized));
}

/* Weak because two byte-identical station sets are semantically equal even
 * though the full bodies (servedAt) differ. FNV-1a, two lanes for 64 bits —
 * a revalidation hint, not an integrity check. */
function weakEtag(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01234567;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x01000193) >>> 0;
  }
  const hex = (value32: number) => value32.toString(16).padStart(8, "0");
  return `W/"${hex(h1)}${hex(h2)}"`;
}

function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  /* Weak comparison (RFC 9110 §8.8.3.2): W/ prefixes do not distinguish. */
  const bare = (tag: string) => (tag.startsWith("W/") ? tag.slice(2) : tag);
  return ifNoneMatch
    .split(",")
    .some((candidate) => bare(candidate.trim()) === bare(etag));
}
