/* Builds the documents committed under schema/ from the live zod schemas.
 * Shared by scripts/emit-schemas.mjs (which imports the built dist) and the
 * drift test (which imports src), so both regenerate byte-identical output
 * and a contract change cannot land without refreshing schema/. */
import { z } from "zod";

/* io: "input" deliberately: the wire contract's evolution rules say readers
 * ignore unknown keys (zod strip mode is load-bearing), so the published
 * schema must not carry additionalProperties: false — a validator enforcing
 * it would reject every future additive change.
 *
 * Shared shapes (Station, Reading, History, …) land in $defs and are $ref'd:
 * the contract registers them with `.meta({ id })`, so the two documents
 * reference one named definition each instead of inlining the station shape
 * four times over. Field `.describe()` annotations ride along, so the
 * published schemas carry the contract's meaning, not just its shape. */
function schemaDocument(schema, filename, title, description) {
  /* Schemas carrying a registry id (.meta({ id })) are extracted into $defs
   * and $ref'd automatically; everything anonymous stays inline. */
  const generated = z.toJSONSchema(schema, { io: "input" });
  return {
    $schema: generated.$schema,
    $id: `https://meteo.azohra.com/schema/${filename}`,
    title,
    description,
    ...generated,
  };
}

/* A realistic three-station document: a Tempest station carrying the extended
 * air block (note uvIndex, and null meaning "not reported here"), a WindNerd
 * station carrying minute-period history with one dark-thermometer point and
 * the optional pressure add-on — its history points carry sea-level-reduced
 * pressure (nullable, like every additive field) and its conditions block
 * fills only the pressure fields — and a degraded station showing the other
 * union arm: status "unavailable" with a reason code and meta intact, which
 * is what either healthy station becomes when its upstream fails.
 * Speeds are wire-unit m/s. */
const exampleFeed = {
  $comment:
    "Example @azohra/meteo/station feed document. Validates against stationfeed.schema.json; " +
    "readers must ignore unknown keys (this one included).",
  schemaVersion: 1,
  servedAt: "2026-08-05T22:13:00.000Z",
  primaryStationId: "meadow",
  stations: [
    /* Every station is fictional: illustrative names, example URLs, round
     * coordinates. An example document must never point at real hardware. */
    {
      id: "meadow",
      name: "Ridge Meadow",
      sourceLabel: "Tempest",
      pageUrl: "https://example.com/stations/ridge-meadow",
      latitude: 49.5,
      longitude: -118.5,
      timeZone: "America/Vancouver",
      elevationM: 1180,
      capabilities: { gustLull: true, temperature: true, conditions: true, history: false },
      samplingWindowSeconds: 60,
      recommendedPollSeconds: 60,
      status: "ok",
      reading: {
        observedAt: "2026-08-05T22:13:00.000Z",
        averageMps: 2.5,
        directionDeg: 273,
        gustMps: 4.2,
        lullMps: 1.1,
        temperatureC: 21.5,
        windChillC: 20.9,
        conditions: {
          dewPointC: 7.5,
          lastLightningStrikeAt: null,
          lastLightningStrikeDistanceKm: null,
          lightningStrikeCountLastHour: null,
          precipitationMinutesToday: 0,
          precipitationRateMmPerHour: 0,
          precipitationTodayMm: 0,
          pressureTrend: "steady",
          relativeHumidityPercent: 40,
          seaLevelPressureHpa: 1014.2,
          solarRadiationWm2: 645,
          uvIndex: 5.8,
        },
      },
      history: null,
    },
    {
      id: "bluff",
      name: "Bluff Launch",
      sourceLabel: "WindNerd",
      pageUrl: "https://example.com/stations/bluff-launch",
      latitude: 49.7,
      longitude: -118.2,
      timeZone: "America/Vancouver",
      elevationM: 1370,
      capabilities: { gustLull: true, temperature: true, conditions: true, history: true },
      samplingWindowSeconds: 60,
      recommendedPollSeconds: 60,
      status: "ok",
      reading: {
        observedAt: "2026-08-05T22:12:45.000Z",
        averageMps: 2.5,
        directionDeg: 290,
        gustMps: 3.9,
        lullMps: 1.7,
        temperatureC: 22.6,
        windChillC: null,
        /* The optional pressure board fills only the pressure fields; the
         * rest stay null — "not reported here". */
        conditions: {
          dewPointC: null,
          lastLightningStrikeAt: null,
          lastLightningStrikeDistanceKm: null,
          lightningStrikeCountLastHour: null,
          precipitationMinutesToday: null,
          precipitationRateMmPerHour: null,
          precipitationTodayMm: null,
          pressureTrend: "steady",
          relativeHumidityPercent: null,
          seaLevelPressureHpa: 1006.1,
          solarRadiationWm2: null,
          uvIndex: null,
        },
      },
      history: {
        periodMinutes: 1,
        points: [
          {
            observedAt: "2026-08-05T22:10:45.000Z",
            averageMps: 1.7,
            gustMps: 2.2,
            lullMps: 1.1,
            directionDeg: 300,
            temperatureC: 20.2,
            seaLevelPressureHpa: 1007.7,
          },
          {
            observedAt: "2026-08-05T22:11:45.000Z",
            averageMps: 3.3,
            gustMps: 5.8,
            lullMps: 1.9,
            directionDeg: 310,
            temperatureC: null,
            seaLevelPressureHpa: null,
          },
          {
            observedAt: "2026-08-05T22:12:45.000Z",
            averageMps: 2.5,
            gustMps: 3.9,
            lullMps: 1.7,
            directionDeg: 290,
            temperatureC: 22.6,
            seaLevelPressureHpa: 1006.1,
          },
        ],
      },
    },
    /* The degraded arm: the upstream failed, the station says so with a
     * machine reason and keeps its identity — never stale numbers. */
    {
      id: "narrows",
      name: "Gorge Narrows",
      sourceLabel: "Campbell logger",
      pageUrl: "https://example.com/stations/gorge-narrows",
      latitude: 49.3,
      longitude: -118.8,
      timeZone: "America/Vancouver",
      elevationM: 460,
      capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
      samplingWindowSeconds: 3,
      recommendedPollSeconds: 15,
      status: "unavailable",
      reason: "upstream_error",
      reading: null,
      history: null,
    },
  ],
};

/* The light document /current serves: one station, reading only, history
 * null — same station decoder as the feed. */
const exampleCurrent = {
  $comment:
    "Example @azohra/meteo/station current document. Validates against " +
    "stationcurrent.schema.json; readers must ignore unknown keys (this one included).",
  schemaVersion: 1,
  servedAt: "2026-08-05T22:13:00.000Z",
  station: {
    ...exampleFeed.stations[0],
    history: null,
  },
};

/* Returns { filename: document } for everything committed under schema/. */
export function buildSchemaDocuments({ stationFeedSchema, stationCurrentSchema }) {
  return {
    "stationfeed.schema.json": schemaDocument(
      stationFeedSchema,
      "stationfeed.schema.json",
      "StationFeed",
      "The multi-station feed served at /feed. Readers must ignore unknown keys: new fields arrive nullable without a schemaVersion bump.",
    ),
    "stationcurrent.schema.json": schemaDocument(
      stationCurrentSchema,
      "stationcurrent.schema.json",
      "StationCurrent",
      "The single-station light document served at /current. Reuses the station shape with history null so clients need one decoder.",
    ),
    "example-feed.json": exampleFeed,
    "example-current.json": exampleCurrent,
  };
}

export function renderSchemaDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}
