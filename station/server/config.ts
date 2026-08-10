/* Station configuration: what an integrator writes down about the hardware.
 * Everything here is a claim about the physical installation — which vendor,
 * where it stands, what boards it carries — never about the current weather.
 * Validation happens per feed assembly; adapters trust the parsed shape from
 * then on, and a station whose claim fails validation degrades to
 * unavailable/not_configured rather than costing the feed. */
import { z } from "zod";
import { httpUrl, ianaTimeZone, positionFields } from "../../core/schema.js";
import type { Station } from "../contract.js";
import { normalizeWindnerdStationKey, windnerdStationUrl } from "../windnerd.js";
import type { ResolvedEnvironment } from "./environment.js";

/* Re-exported for compatibility; the canonical home is the isomorphic root,
 * where an admin UI can reach them without pulling in server code. */
export { normalizeWindnerdStationKey, windnerdStationUrl };

const windnerdStationKey = z
  .string()
  .refine((value) => normalizeWindnerdStationKey(value) != null, {
    message: "not a WindNerd station key or windnerd.net station URL",
  })
  .transform((value) => normalizeWindnerdStationKey(value) as string);

/* Identity fields accept null as well as absence: integrator config usually
 * comes from database rows, where "we don't know" is null — forcing callers
 * to launder null into undefined would fail the contract's own rule that
 * absence is null. */
const stationIdentity = {
  id: z.string().min(1),
  name: z.string().min(1),
  /* Config elevation and position (core/schema's shared claim fields) are
   * fallbacks; an adapter that learns them from the vendor (Tempest reports
   * elevation and position) wins. */
  ...positionFields,
  /* IANA zone of the station's locale, for clients formatting station-local
   * time. Optional here; Campbell overrides it as required because its logger
   * stamps naive local time and cannot be decoded without one. */
  timeZone: ianaTimeZone.nullish(),
  /* Overrides the adapter's default station page — a logger with a public
   * mirror, a Tempest fronted by the owner's own site. */
  pageUrl: httpUrl.nullish(),
};

/* All three vendor schemas are strict: a misspelled key silently defaulting
 * (hasTemp, historyTables) is a validated config lying about the hardware. */
export const windnerdStationConfigSchema = z
  .strictObject({
    vendor: z.literal("windnerd"),
    ...stationIdentity,
    stationKey: windnerdStationKey,
    locationId: z.number().int().positive(),
    /* The thermometer is an optional board and the records API cannot tell an
     * absent board from a dark sensor — the owner has to say which they have. */
    hasTemperature: z.boolean().default(true),
    /* The pressure/temperature sensor is an optional OnSpot add-on; existing
     * configs keep pressure off until the owner declares the hardware. */
    hasPressure: z.boolean().default(false),
  })
  /* The wire carries raw station pressure; reducing it to sea level is a
   * function of the barometer's height, so a pressure claim without an
   * elevation claim is unusable. */
  .refine((config) => !config.hasPressure || config.elevationM != null, {
    message:
      "pressure needs the sensor's elevation to reduce to sea level — " +
      "set elevationM to the sensor's elevation, not the launch's",
    path: ["elevationM"],
  });
export type WindnerdStationConfig = z.output<typeof windnerdStationConfigSchema>;

export const tempestStationConfigSchema = z.strictObject({
  vendor: z.literal("tempest"),
  ...stationIdentity,
  stationId: z.number().int().positive(),
  token: z.string().min(1),
});
export type TempestStationConfig = z.output<typeof tempestStationConfigSchema>;

export const campbellStationConfigSchema = z.strictObject({
  vendor: z.literal("campbell"),
  ...stationIdentity,
  baseUrl: httpUrl,
  /* The DataQuery data source, "<logger>:<station name>". The station name
   * after the colon is verified against the response's own claim. */
  source: z.string().min(1),
  /* Required because the logger stamps naive station-local time — without a
   * zone those stamps are not instants. Match the zone to the logger clock's
   * actual behavior: Campbell's own guidance leaves many loggers on standard
   * time year-round, and those installs must configure the fixed-offset zone
   * — Etc/GMT+8 for Pacific standard time (POSIX inverts the sign) — not
   * America/Vancouver. A DST zone over a standard-time clock reads an hour
   * early all summer; the adapter warns when it sees that hour. */
  timeZone: ianaTimeZone,
  currentTable: z.string().min(1).default("I3Sec"),
  historyTable: z.string().min(1).default("I5Min"),
  currentIntervalSeconds: z.number().finite().positive().default(3),
  historyPeriodMinutes: z.number().finite().positive().default(5),
  /* TTL over the current-table cache, which bounds how live "current" can be.
   * The floor keeps a shared logger from being hammered; the advertised
   * recommendedPollSeconds stays honest against whatever is configured. */
  currentCacheTtlSeconds: z.number().finite().min(3).default(15),
});
export type CampbellStationConfig = z.output<typeof campbellStationConfigSchema>;

/* The parsed config's own identity claims, handed back to the loader so it
 * can build StationMeta (or a degraded arm) without re-declaring the fields
 * it already wrote in the config. Nullish claims arrive normalized to null —
 * the contract's spelling of absence. */
export type CustomStationIdentity = {
  readonly id: string;
  readonly name: string;
  readonly elevationM: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timeZone: string | null;
  readonly pageUrl: string | null;
};

/* What a custom loader is told about the request it is serving. mode
 * "current" asks for a reading only — return history null and keep meta
 * intact, exactly like the built-in light loaders. */
export type CustomStationContext = {
  environment: ResolvedEnvironment;
  historyHours: number;
  mode: "full" | "current";
  /* The validated identity from this station's own config entry. */
  station: CustomStationIdentity;
};

export type CustomStationLoader = (context: CustomStationContext) => Promise<Station>;

/* The open adapter arm: any station a vendor adapter does not exist for. The
 * returned Station is validated against the wire schema — an invalid
 * return degrades that one station to unavailable/contract_break, never the
 * feed. The rulebook for built-in adapters applies: never throw for an
 * upstream failure, declare capabilities, keep absent quantities null. */
export const customStationConfigSchema = z.strictObject({
  vendor: z.literal("custom"),
  ...stationIdentity,
  load: z.custom<CustomStationLoader>((value) => typeof value === "function", {
    message: "load must be a function returning Promise<Station>",
  }),
});
export type CustomStationConfig = z.output<typeof customStationConfigSchema>;

export const stationConfigSchema = z.discriminatedUnion("vendor", [
  windnerdStationConfigSchema,
  tempestStationConfigSchema,
  campbellStationConfigSchema,
  customStationConfigSchema,
]);
export type StationConfig = z.output<typeof stationConfigSchema>;
export type StationConfigInput = z.input<typeof stationConfigSchema>;

export function parseStationConfig(value: unknown): StationConfig {
  return stationConfigSchema.parse(value);
}
