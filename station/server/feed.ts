/* The data-level feed API: assemble station configs, load every station, and
 * return contract documents — no HTTP anywhere. createStationFeedHandler is a
 * thin wrapper over these; call them directly from a cron job, a static-site
 * build, or a framework loader.
 *
 * Degradation is owned here, in three belts:
 * - a station config that fails validation (or repeats an id) degrades that
 *   one station to unavailable/not_configured — a bad database row must never
 *   500 the feed;
 * - an adapter that throws instead of degrading costs one station
 *   (contract_break), not the response;
 * - a custom loader's return is validated against the wire schema, and an
 *   invalid return degrades to contract_break; a custom loader that THROWS
 *   degrades through unavailableReasonForError instead, so a thrown
 *   UpstreamError keeps its honest reason (timeout stays timeout). */
import {
  SCHEMA_VERSION,
  stationSchema,
  unavailableStation,
  type Station,
  type StationCurrent,
  type StationFeed,
  type StationMeta,
} from "../contract.js";
import { loadCampbellStation } from "./adapters/campbell.js";
import { loadTempestStation } from "./adapters/tempest.js";
import { loadWindnerdStation } from "./adapters/windnerd.js";
import {
  stationConfigSchema,
  type CustomStationConfig,
  type CustomStationIdentity,
  type StationConfig,
  type StationConfigInput,
} from "./config.js";
import {
  logUpstreamFailure,
  resolveEnvironment,
  unavailableReasonForError,
  type ResolvedEnvironment,
  type ServerEnvironment,
} from "./environment.js";
import type { ZodError } from "zod";

/* The one copy: adapters and the handler import it from here. */
export const DEFAULT_HISTORY_HOURS = 6;

/* Stations may be a static list or a resolver — a database read, a KV fetch —
 * called once per assembly. The request is present when the handler invoked
 * it (multi-tenant hosts route on it); a bare loadStationFeed call passes
 * whatever its caller provided, usually nothing. */
export type StationsResolver = (
  request?: Request,
) => Promise<StationConfigInput[]> | StationConfigInput[];
export type StationsInput = StationConfigInput[] | StationsResolver;

export type LoadStationFeedOptions = {
  stations: StationsInput;
  primaryStationId?: string;
  /* This call's history window. Clamped to maxHistoryHours when both are
   * given; a missing or non-positive value falls back to the ceiling. */
  historyHours?: number;
  maxHistoryHours?: number;
  environment?: ServerEnvironment;
  /* Forwarded to a stations resolver, never read here. */
  request?: Request;
};

export type LoadStationCurrentOptions = LoadStationFeedOptions & {
  /* The station to serve — one id in the same options bag, so call sites
   * read the same as loadStationFeed's. */
  stationId: string;
};

/* Thrown by loadStationCurrent when no configured station carries the id —
 * the one failure that cannot be expressed as a degraded station, because
 * there is no station to degrade. The handler maps it to 404. */
export class UnknownStationError extends Error {
  constructor(stationId: string) {
    super(`no station is configured with id "${stationId}"`);
    this.name = "UnknownStationError";
  }
}

export async function loadStationFeed(options: LoadStationFeedOptions): Promise<StationFeed> {
  const environment = resolveEnvironment(options.environment);
  const assembled = assembleStations(await resolveStations(options, environment), environment);
  const historyHours = effectiveHistoryHours(options);
  const stations = await Promise.all(
    assembled.map((entry) => loadAssembledStation(entry, environment, historyHours, "full")),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    servedAt: environment.now().toISOString(),
    primaryStationId: options.primaryStationId ?? null,
    stations,
  };
}

export async function loadStationCurrent(
  options: LoadStationCurrentOptions,
): Promise<StationCurrent> {
  const environment = resolveEnvironment(options.environment);
  const assembled = assembleStations(await resolveStations(options, environment), environment);
  const entry = assembled.find(
    (candidate) =>
      ("config" in candidate ? candidate.config.id : candidate.degraded.id) === options.stationId,
  );
  if (!entry) throw new UnknownStationError(options.stationId);
  const station = await loadAssembledStation(
    entry,
    environment,
    effectiveHistoryHours(options),
    "current",
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    servedAt: environment.now().toISOString(),
    station,
  };
}

async function resolveStations(
  options: LoadStationFeedOptions,
  environment: ResolvedEnvironment,
): Promise<StationConfigInput[]> {
  if (Array.isArray(options.stations)) return options.stations;
  const resolved = await options.stations(options.request);
  if (!Array.isArray(resolved)) {
    environment.logger({
      level: "error",
      code: "resolver_invalid",
      message: "stations resolver returned a non-array; serving an empty feed",
      detail: { returned: typeof resolved },
    });
    return [];
  }
  return resolved;
}

function effectiveHistoryHours(options: {
  historyHours?: number;
  maxHistoryHours?: number;
}): number {
  const ceiling = options.maxHistoryHours ?? DEFAULT_HISTORY_HOURS;
  const requested = options.historyHours;
  const wanted =
    requested != null && Number.isFinite(requested) && requested > 0 ? requested : ceiling;
  return options.maxHistoryHours != null ? Math.min(wanted, options.maxHistoryHours) : wanted;
}

type AssembledStation = { config: StationConfig } | { degraded: Station };

/* Validates every candidate and checks id uniqueness. Failures degrade —
 * never throw — so one corrupt row costs one feed entry. Exposed for the
 * handler's eager construction-time pass over static arrays. */
export function assembleStations(
  candidates: StationConfigInput[],
  environment: ResolvedEnvironment,
): AssembledStation[] {
  const seen = new Set<string>();
  return candidates.map((candidate, index): AssembledStation => {
    const result = stationConfigSchema.safeParse(candidate);
    if (!result.success) {
      environment.logger({
        level: "warn",
        code: "config_invalid",
        message: `station config at index ${index} is invalid — serving it unavailable (not_configured)`,
        detail: { index, issues: describeIssues(result.error) },
      });
      const meta = scavengedMeta(candidate, index);
      seen.add(meta.id);
      return { degraded: unavailableStation(meta, "not_configured") };
    }
    if (seen.has(result.data.id)) {
      environment.logger({
        level: "warn",
        code: "duplicate_station",
        message:
          `duplicate station id "${result.data.id}" at index ${index} — ` +
          "serving the duplicate unavailable (not_configured); ids must be unique per feed",
        detail: { index, station: result.data.id },
      });
      return { degraded: unavailableStation(configFallbackMeta(result.data), "not_configured") };
    }
    seen.add(result.data.id);
    return { config: result.data };
  });
}

function describeIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(config)"}: ${issue.message}`)
    .join("; ");
}

/* Identity for a config that failed validation: whatever id and name survive
 * scavenging, so the degraded entry is still recognizable in the feed. */
function scavengedMeta(candidate: unknown, index: number): StationMeta {
  const record =
    typeof candidate === "object" && candidate !== null
      ? (candidate as Record<string, unknown>)
      : {};
  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : `station-${index}`;
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : id;
  return {
    id,
    name,
    sourceLabel: typeof record.vendor === "string" ? record.vendor : "unknown",
    pageUrl: null,
    latitude: null,
    longitude: null,
    timeZone: null,
    elevationM: null,
    capabilities: { gustLull: false, temperature: false, conditions: false, history: false },
    samplingWindowSeconds: null,
    recommendedPollSeconds: 60,
  };
}

/* Identity for a validated config whose station never produced a document —
 * a duplicate id, a throwing adapter, a lying custom loader. */
function configFallbackMeta(config: StationConfig): StationMeta {
  return {
    id: config.id,
    name: config.name,
    sourceLabel: config.vendor,
    pageUrl: null,
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    timeZone: config.timeZone ?? null,
    elevationM: config.elevationM ?? null,
    capabilities: { gustLull: false, temperature: false, conditions: false, history: false },
    samplingWindowSeconds: null,
    recommendedPollSeconds: 60,
  };
}

async function loadAssembledStation(
  entry: AssembledStation,
  environment: ResolvedEnvironment,
  historyHours: number,
  mode: "full" | "current",
): Promise<Station> {
  if ("degraded" in entry) return entry.degraded;
  return loadStation(entry.config, environment, historyHours, mode).catch((error) =>
    neverThrewButDid(entry.config, environment, error),
  );
}

async function loadStation(
  config: StationConfig,
  environment: ResolvedEnvironment,
  historyHours: number,
  mode: "full" | "current",
): Promise<Station> {
  /* Every built-in adapter is a defineStationAdapter product: the try/catch
   * belt, reason mapping, and current-mode slimming live in that one helper. */
  switch (config.vendor) {
    case "windnerd":
      return loadWindnerdStation(config, { historyHours, mode, environment });
    case "tempest":
      return loadTempestStation(config, { historyHours, mode, environment });
    case "campbell":
      return loadCampbellStation(config, { historyHours, mode, environment });
    case "custom":
      return loadCustomStation(config, environment, historyHours, mode);
  }
}

async function loadCustomStation(
  config: CustomStationConfig,
  environment: ResolvedEnvironment,
  historyHours: number,
  mode: "full" | "current",
): Promise<Station> {
  let returned: Station;
  try {
    returned = await config.load({
      environment,
      historyHours,
      mode,
      station: customStationIdentity(config),
    });
  } catch (error) {
    /* A thrown failure gets the same honesty as a built-in adapter's:
     * unavailableReasonForError maps an UpstreamError("…", "timeout") to
     * "timeout", a network TypeError to "upstream_error", and only an
     * unrecognized throw to "contract_break" — that code's reserved meaning
     * here is an invalid RETURNED document (below) or a throw the loader
     * never classified. */
    logUpstreamFailure(environment, `${config.name} live wind unavailable`, error, {
      station: config.id,
    });
    return unavailableStation(configFallbackMeta(config), unavailableReasonForError(error));
  }
  const parsed = stationSchema.safeParse(returned);
  if (!parsed.success) {
    environment.logger({
      level: "error",
      code: "custom_contract_break",
      message: `${config.name} custom loader returned an invalid Station`,
      detail: { station: config.id, issues: describeIssues(parsed.error) },
    });
    return unavailableStation(configFallbackMeta(config), "contract_break");
  }
  /* Light mode slims a loader that ignored it; meta stays intact. */
  return mode === "current" && parsed.data.status === "ok"
    ? { ...parsed.data, history: null }
    : parsed.data;
}

/* The loader-facing copy of the config's identity claims, nullish claims
 * normalized to null — the contract's spelling of absence. */
function customStationIdentity(config: CustomStationConfig): CustomStationIdentity {
  return {
    id: config.id,
    name: config.name,
    elevationM: config.elevationM ?? null,
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    timeZone: config.timeZone ?? null,
    pageUrl: config.pageUrl ?? null,
  };
}

/* Adapters degrade internally and never throw; this is the belt behind that
 * promise, so an adapter bug still costs one station, not the response. */
function neverThrewButDid(
  config: StationConfig,
  environment: ResolvedEnvironment,
  error: unknown,
): Station {
  environment.logger({
    level: "error",
    code: "adapter_threw",
    message: `${config.name} adapter threw instead of degrading`,
    detail: { error: error instanceof Error ? error.message : String(error), station: config.id },
  });
  return unavailableStation(configFallbackMeta(config), "contract_break");
}
