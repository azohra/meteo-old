/* The wire contract between a station feed handler and its clients.
 *
 * Design rules, in order:
 * - Capabilities are declared, never inferred from nulls. A station that
 *   carries no thermometer says so; a thermometer that is dark right now
 *   reports null. The two are different facts and both are representable.
 * - Absence stays absent: a missing quantity is null, never zero.
 * - No prose on the wire. Failures carry a reason code; display language is
 *   a client concern. Compass words are derived client-side from degrees.
 * - The client judges freshness. The wire carries observedAt plus servedAt
 *   (the server clock at response time) so a client can subtract its own
 *   clock skew out of the calculation.
 * - Calm carries no direction: below the WMO calm threshold (0.5 m/s —
 *   derive's CALM_THRESHOLD_MPS) directionDeg is null. A vane parked below
 *   its start-up torque, or a sonic head reading thermal drift, would
 *   fabricate a bearing. The measured speed still travels.
 * - The contract validates shape; adapters validate plausibility. Speed
 *   bounds live in the adapters, where a lying instrument degrades one
 *   station instead of nulling the whole document.
 * - Units are SI on the wire: speeds are m/s. Display units (km/h, knots,
 *   mph) are a client conversion via derive's speedFromMps. Everything else
 *   keeps its conventional unit: °C, hPa, mm, km (lightning distance),
 *   W/m², degrees.
 */
import { z } from "zod";

/* Evolution rules — normative, not advisory:
 *
 * - Additive change (a new field) never bumps SCHEMA_VERSION. New fields
 *   arrive nullable, with null meaning what absence meant before. Readers
 *   ignore unknown keys: zod's strip mode is load-bearing here — never
 *   switch these schemas to strict.
 * - New capability keys must arrive `.nullish()` (null = undeclared =
 *   false): a required boolean would brick every already-published document
 *   that predates the key.
 * - Reserved for a future additive change: a `health` block of per-poll
 *   station telemetry (batteryVolts, rssiDbm, lastHeardAt), every field
 *   nullish. When it ships it rides BOTH status arms — a station too sick to
 *   produce a reading is exactly the one whose battery voltage matters.
 * - SCHEMA_VERSION bumps only when an existing field changes meaning, unit,
 *   or shape, or is removed. A reader rejecting an unrecognized version is
 *   then the intended behavior, not a bug.
 * - Because parsing strips unknown keys, parse-then-reserialize is lossy.
 *   A proxy must pass bodies through verbatim.
 */
export const SCHEMA_VERSION = 1;

export const UNAVAILABLE_REASONS = [
  "upstream_error",
  "contract_break",
  "timeout",
  "not_configured",
  "rate_limited",
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/* z.object = strip mode in zod v4 — load-bearing, see evolution rules. */

const isoTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "not an ISO timestamp",
  })
  .meta({ format: "date-time" });

const speedMps = z.number().finite().min(0);
const directionDeg = z.number().finite().min(0).lt(360);

/* Extended air data. This block is WeatherFlow-shaped — pressureTrend's enum
 * and the fixed one-hour lightning bucket are Tempest's vocabulary, and the
 * "today" fields anchor to the station's local day. It ships because one
 * vendor fills it well, and every field is nullable because no other vendor
 * does. Treat it as extensible, not universal.
 *
 * Null semantics inside this block, deliberately: null means "not reported
 * here" and does not distinguish a missing sensor from a dark one. The
 * station-level capability flag gates whether a client allocates UI
 * structure for conditions at all; per-field capability flags would grow
 * with every field and are declined. */
export const airConditionsSchema = z
  .object({
    dewPointC: z.number().finite().nullable(),
    lastLightningStrikeAt: isoTime.nullable(),
    lastLightningStrikeDistanceKm: z.number().finite().nullable(),
    lightningStrikeCountLastHour: z.number().finite().nullable(),
    precipitationMinutesToday: z.number().finite().nullable(),
    precipitationRateMmPerHour: z.number().finite().nullable(),
    precipitationTodayMm: z.number().finite().nullable(),
    pressureTrend: z.enum(["falling", "rising", "steady", "unknown"]).nullable(),
    relativeHumidityPercent: z.number().finite().nullable(),
    seaLevelPressureHpa: z.number().finite().nullable(),
    solarRadiationWm2: z.number().finite().nullable(),
    uvIndex: z.number().finite().min(0).nullable(),
  })
  .describe(
    "Extended air data. null means 'not reported here' — it does not " +
      "distinguish a missing sensor from a dark one; the station-level " +
      "conditions capability gates whether a client allocates UI structure.",
  )
  .meta({ id: "AirConditions" });
export type AirConditions = z.infer<typeof airConditionsSchema>;

export const readingSchema = z
  .object({
    observedAt: isoTime,
    /* The reading IS a windowed average — samplingWindowSeconds says over
     * what. Reading and history share the name for the same quantity. */
    averageMps: speedMps.describe(
      "Wind speed in m/s, averaged over samplingWindowSeconds. " +
        "Absence is null, never zero.",
    ),
    directionDeg: directionDeg
      .nullable()
      .describe(
        "Bearing the wind blows FROM, degrees [0, 360). null exactly when " +
          "calm (averageMps below the WMO 0.5 m/s threshold) — calm carries " +
          "no direction; a null on a blowing reading is a dead vane.",
      ),
    gustMps: speedMps.nullable().describe("Peak m/s within the sampling window; null ≠ zero."),
    lullMps: speedMps.nullable().describe("Minimum m/s within the sampling window; null ≠ zero."),
    temperatureC: z.number().finite().nullable(),
    windChillC: z.number().finite().nullable(),
    conditions: airConditionsSchema.nullable(),
  })
  .meta({ id: "Reading" });
export type Reading = z.infer<typeof readingSchema>;

export const historyPointSchema = z
  .object({
    observedAt: isoTime,
    averageMps: speedMps.describe("Mean m/s over the record's period."),
    gustMps: speedMps.nullable(),
    lullMps: speedMps.nullable(),
    directionDeg: directionDeg
      .nullable()
      .describe("Degrees FROM; null exactly when the period was calm (below 0.5 m/s)."),
    temperatureC: z.number().finite().nullable(),
    /* Sea-level corrected, so points are comparable across stations and with
     * forecasts. Additive per the evolution rules above: nullish, no version
     * bump, and documents that predate the field still parse. */
    seaLevelPressureHpa: z.number().finite().positive().nullish(),
  })
  .meta({ id: "HistoryPoint" });
export type HistoryPoint = z.infer<typeof historyPointSchema>;

/* periodMinutes is on the wire because wind run, vane thinning, and dropout
 * detection are all functions of it — a client cannot treat 1-minute WindNerd
 * records and 5-minute logger records alike. A dropout is an absent record,
 * never a zeroed one. */
export const historySchema = z
  .object({
    periodMinutes: z
      .number()
      .finite()
      .positive()
      .describe(
        "Minutes each point covers. Wind run, vane thinning, and dropout " +
          "detection are functions of it.",
      ),
    points: z
      .array(historyPointSchema)
      .describe("A dropout is an ABSENT record, never a zeroed one — gaps carry no points."),
  })
  .meta({ id: "History" });
export type History = z.infer<typeof historySchema>;

/* Evolution note: new capability keys must arrive .nullish() with null
 * meaning undeclared (= false) — a required boolean would brick every
 * already-published document. These four predate the rule and stay required. */
export const capabilitiesSchema = z
  .object({
    gustLull: z.boolean(),
    temperature: z.boolean(),
    conditions: z.boolean(),
    history: z.boolean(),
  })
  .describe(
    "Declared from what the hardware carries, never inferred from data. " +
      "Capabilities gate client UI structure; a dark sensor keeps its " +
      "structure and reports null.",
  )
  .meta({ id: "StationCapabilities" });
export type StationCapabilities = z.infer<typeof capabilitiesSchema>;

const stationMetaShape = {
  id: z.string().min(1),
  name: z.string().min(1),
  /* Display-only attribution ("WindNerd", "Campbell logger"); never parsed. */
  sourceLabel: z.string(),
  pageUrl: z.string().nullable(),
  /* Position is first-class: maps, proximity sorting, and station-local time
   * are all functions of it. Nullable so an owner can withhold it, never so
   * an adapter can skip it — adapters fill from upstream when the vendor
   * reports position, from config otherwise. */
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).lt(180).nullable(),
  /* IANA zone of the station's locale, for clients formatting "today" and
   * period summaries for remote viewers. */
  timeZone: z.string().min(1).nullable(),
  elevationM: z.number().finite().nullable(),
  capabilities: capabilitiesSchema,
  /* The window gust and lull are measured over — a 3 s instrument and a
   * 1-minute record mean different things by "gust". Distinct from both the
   * history period and the poll cadence. */
  samplingWindowSeconds: z.number().finite().positive().nullable(),
  /* Server-advised client poll cadence; honest about upstream cache TTLs. */
  recommendedPollSeconds: z.number().finite().positive(),
};

export const stationMetaSchema = z.object(stationMetaShape);
export type StationMeta = z.infer<typeof stationMetaSchema>;

/* One station: identity and capabilities on both arms, with either a reading
 * (status "ok") or a machine reason code (status "unavailable") — never
 * prose, never stale numbers. */
export const stationSchema = z
  .discriminatedUnion("status", [
    z.object({
      ...stationMetaShape,
      status: z.literal("ok"),
      reading: readingSchema,
      history: historySchema.nullable(),
    }),
    z.object({
      ...stationMetaShape,
      status: z.literal("unavailable"),
      reason: z.enum(UNAVAILABLE_REASONS),
      reading: z.null(),
      history: z.null(),
    }),
  ])
  .meta({ id: "Station" });
export type Station = z.infer<typeof stationSchema>;

export const stationFeedSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  servedAt: isoTime.describe(
    "The server clock at response time. Freshness is judged client-side " +
      "against this anchor, so a wrong client clock cannot declare a live " +
      "station stale.",
  ),
  primaryStationId: z.string().nullable(),
  stations: z.array(stationSchema),
});
export type StationFeed = z.infer<typeof stationFeedSchema>;

/* The light endpoint: one station, reading only, history omitted. Reuses
 * the station shape with history null so clients need one decoder. */
export const stationCurrentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  servedAt: isoTime,
  station: stationSchema,
});
export type StationCurrent = z.infer<typeof stationCurrentSchema>;

export function parseStationFeed(value: unknown): StationFeed | null {
  const result = stationFeedSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStationFeedJson(text: string): StationFeed | null {
  try {
    return parseStationFeed(JSON.parse(text));
  } catch {
    return null;
  }
}

export function parseStationCurrent(value: unknown): StationCurrent | null {
  const result = stationCurrentSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStationCurrentJson(text: string): StationCurrent | null {
  try {
    return parseStationCurrent(JSON.parse(text));
  } catch {
    return null;
  }
}

/* A contract-shaped conditions block with every field null — the honest
 * starting point for an adapter (or custom loader) whose station carries one
 * or two conditions-class sensors: spread the measured fields over it and
 * every absent quantity stays null, never zero. */
export function emptyConditions(overrides: Partial<AirConditions> = {}): AirConditions {
  return {
    dewPointC: null,
    lastLightningStrikeAt: null,
    lastLightningStrikeDistanceKm: null,
    lightningStrikeCountLastHour: null,
    precipitationMinutesToday: null,
    precipitationRateMmPerHour: null,
    precipitationTodayMm: null,
    pressureTrend: null,
    relativeHumidityPercent: null,
    seaLevelPressureHpa: null,
    solarRadiationWm2: null,
    uvIndex: null,
    ...overrides,
  };
}

/* The degradation shape adapters return when an upstream fails or lies.
 * Rendering a guess is worse than saying so. */
export function unavailableStation(
  meta: StationMeta,
  reason: UnavailableReason,
): Station {
  return { ...meta, status: "unavailable", reason, reading: null, history: null };
}
