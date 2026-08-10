/* A realistic six-hour StationFeed, generated rather than fetched. Everything is
 * a deterministic function of the clock: reload and the same day redraws;
 * advance nowMs and the readings tick while history points append on minute
 * boundaries — which is exactly what the "simulate live" toggle does.
 *
 * A mirror of examples/demo/src/fixtures.ts — workspace packages do not
 * share src; the two demos deliberately render the same synthetic day. */
import { SCHEMA_VERSION, normalizeDegrees, speedToMps, unavailableStation } from "@azohra/meteo/station";
import type { HistoryPoint, Reading, Station, StationFeed } from "@azohra/meteo/station";

const MINUTE_MS = 60_000;

const iso = (ms: number) => new Date(ms).toISOString();
const round1 = (value: number) => Math.round(value * 10) / 10;
/* The shapes below are authored in km/h (they were tuned by eye in km/h);
 * the wire speaks m/s, so every speed converts at construction. Two decimals
 * keep the displayed km/h values effectively unchanged. */
const mps = (kmh: number) => Math.round(speedToMps(kmh, "kmh") * 100) / 100;

/* Deterministic wobble in roughly [-1, 1]. */
const wobble = (seed: number) =>
  (Math.sin(seed * 12.9898) + Math.sin(seed * 4.1414 + 1.3)) / 2;

/* --- Station A: "Launch Ridge" — WindNerd-ish, 1-minute records. Calm dawn,
 * a light-and-variable hour, then a building NW thermic afternoon, with one
 * 20-minute dropout mid-window (absent records, never zeroed ones). Carries
 * sea-level pressure rising 1009 → 1013 hPa over the window — a clear rising
 * tendency for the trend chart. Summit Logger stays pressure-free on purpose,
 * so the "not measured here" arm has a station to show it. --- */

function launchRidgeHistory(nowMs: number): HistoryPoint[] {
  const anchor = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const points: HistoryPoint[] = [];
  for (let offset = 359; offset >= 1; offset -= 1) {
    if (offset <= 170 && offset > 150) continue; // the dropout
    const minuteIndex = 359 - offset;
    let average: number;
    if (minuteIndex < 90) {
      average = 0;
    } else if (minuteIndex < 130) {
      average = Math.max(0, round1(2 + wobble(minuteIndex) * 2.5));
    } else {
      const build = (minuteIndex - 130) / 229;
      average = Math.max(0, round1(build * 16 + 4 + wobble(minuteIndex) * 3.5));
    }
    const calm = average === 0;
    points.push({
      observedAt: iso(anchor - offset * MINUTE_MS),
      averageMps: mps(average),
      gustMps: calm ? 0 : mps(average * 1.35 + 2 + Math.abs(wobble(minuteIndex * 3)) * 3),
      lullMps: calm ? 0 : mps(Math.max(0, average * 0.6 - 1)),
      directionDeg: calm ? null : round1(normalizeDegrees(312 + wobble(minuteIndex * 7) * 18)),
      temperatureC: round1(9 + (minuteIndex / 359) * 8 + wobble(minuteIndex * 5)),
      /* A steady build with diurnal-scale breathing on top. */
      seaLevelPressureHpa: round1(1009 + (minuteIndex / 359) * 4 + wobble(minuteIndex * 3) * 0.4),
    });
  }
  return points;
}

function launchRidgeReading(nowMs: number): Reading {
  const seed = Math.floor(nowMs / 2_000);
  const average = 19 + wobble(seed) * 4;
  return {
    observedAt: iso(nowMs),
    averageMps: mps(average),
    directionDeg: round1(normalizeDegrees(312 + wobble(seed * 3) * 15)),
    gustMps: mps(average * 1.3 + 3),
    lullMps: mps(average * 0.65),
    temperatureC: round1(16.5 + wobble(seed) * 0.3),
    windChillC: null,
    conditions: null,
  };
}

function launchRidge(nowMs: number): Station {
  return {
    id: "launch-ridge",
    name: "Launch Ridge",
    sourceLabel: "WindNerd",
    pageUrl: "https://example.com/stations/launch-ridge",
    latitude: 49.078,
    longitude: -117.785,
    timeZone: "America/Vancouver",
    elevationM: 1245,
    capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
    samplingWindowSeconds: 3,
    recommendedPollSeconds: 5,
    status: "ok",
    reading: launchRidgeReading(nowMs),
    history: { periodMinutes: 1, points: launchRidgeHistory(nowMs) },
  };
}

/* --- Station B: "Summit Logger" — 5-minute records, stronger air, a steady
 * veer from SSW to WNW, temperature falling toward wind chill territory. --- */

function summitLoggerHistory(nowMs: number): HistoryPoint[] {
  const period = 5 * MINUTE_MS;
  const anchor = Math.floor(nowMs / period) * period;
  const points: HistoryPoint[] = [];
  for (let offset = 71; offset >= 1; offset -= 1) {
    const index = 71 - offset;
    const average = Math.max(0, round1(24 + (index / 71) * 10 + wobble(index * 2) * 5));
    points.push({
      observedAt: iso(anchor - offset * period),
      averageMps: mps(average),
      gustMps: mps(average + 9 + Math.abs(wobble(index * 11)) * 4),
      lullMps: mps(Math.max(0, average - 7)),
      directionDeg: round1(normalizeDegrees(205 + (index / 71) * 110 + wobble(index * 9) * 8)),
      temperatureC: round1(3 - (index / 71) * 4 + wobble(index * 13) * 0.5),
    });
  }
  return points;
}

function summitLogger(nowMs: number): Station {
  const seed = Math.floor(nowMs / 2_000);
  const average = 33 + wobble(seed + 40) * 5;
  return {
    id: "summit-logger",
    name: "Summit Logger",
    sourceLabel: "Campbell logger",
    pageUrl: "https://example.com/stations/summit-logger",
    latitude: 49.106,
    longitude: -117.842,
    timeZone: "America/Vancouver",
    elevationM: 2130,
    capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
    samplingWindowSeconds: 60,
    recommendedPollSeconds: 30,
    status: "ok",
    reading: {
      observedAt: iso(nowMs - 45_000),
      averageMps: mps(average),
      directionDeg: round1(normalizeDegrees(305 + wobble(seed * 5) * 10)),
      gustMps: mps(average + 10),
      lullMps: mps(average - 8),
      temperatureC: -1.2,
      windChillC: -8.4,
      conditions: null,
    },
    history: { periodMinutes: 5, points: summitLoggerHistory(nowMs) },
  };
}

/* --- Station C: "Valley Tempest" — the whole atmosphere, no history. --- */

function valleyTempest(nowMs: number): Station {
  const seed = Math.floor(nowMs / 2_000);
  const average = 9 + wobble(seed + 80) * 3;
  return {
    id: "valley-tempest",
    name: "Valley Tempest",
    sourceLabel: "WeatherFlow Tempest",
    pageUrl: "https://example.com/stations/valley-tempest",
    latitude: 49.099,
    longitude: -117.7,
    timeZone: "America/Vancouver",
    elevationM: 610,
    capabilities: { gustLull: true, temperature: true, conditions: true, history: false },
    samplingWindowSeconds: 60,
    recommendedPollSeconds: 60,
    status: "ok",
    reading: {
      observedAt: iso(nowMs - 20_000),
      averageMps: mps(Math.max(0, average)),
      directionDeg: round1(normalizeDegrees(155 + wobble(seed * 7) * 20)),
      gustMps: mps(average + 5),
      lullMps: mps(Math.max(0, average - 4)),
      temperatureC: 14.3,
      windChillC: null,
      conditions: {
        dewPointC: 8.4,
        lastLightningStrikeAt: iso(nowMs - 47 * MINUTE_MS),
        lastLightningStrikeDistanceKm: 19,
        lightningStrikeCountLastHour: 2,
        precipitationMinutesToday: 12,
        precipitationRateMmPerHour: 0,
        precipitationTodayMm: 1.6,
        pressureTrend: "falling",
        relativeHumidityPercent: 64,
        seaLevelPressureHpa: 1012.6,
        solarRadiationWm2: 512,
        uvIndex: 6.2,
      },
    },
    history: null,
  };
}

/* --- Station D: "North Bluff" — its upstream is down; say so, render on. --- */

const northBluff: Station = unavailableStation(
  {
    id: "north-bluff",
    name: "North Bluff",
    sourceLabel: "WindNerd",
    pageUrl: "https://example.com/stations/north-bluff",
    latitude: 49.128,
    longitude: -117.771,
    timeZone: "America/Vancouver",
    elevationM: 980,
    capabilities: { gustLull: true, temperature: false, conditions: false, history: true },
    samplingWindowSeconds: 3,
    recommendedPollSeconds: 5,
  },
  "upstream_error",
);

export function buildDemoFeed(nowMs: number): StationFeed {
  return {
    schemaVersion: SCHEMA_VERSION,
    servedAt: iso(nowMs),
    primaryStationId: "launch-ridge",
    stations: [launchRidge(nowMs), summitLogger(nowMs), valleyTempest(nowMs), northBluff],
  };
}
