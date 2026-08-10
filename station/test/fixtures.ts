/* Contract-shaped fixtures. BASE_MS is fixed so geometry assertions are
 * deterministic; tests that need freshness pass their own receivedAtMs. */
import type { AirConditions, HistoryPoint, Station, StationFeed } from "../index.js";

export const MINUTE_MS = 60_000;
export const BASE_MS = Date.parse("2026-08-09T18:00:00Z");

export const iso = (ms: number) => new Date(ms).toISOString();

export type OkStation = Extract<Station, { status: "ok" }>;
export type DownStation = Extract<Station, { status: "unavailable" }>;

export function makePoints(
  count: number,
  mutate?: (point: HistoryPoint, index: number) => HistoryPoint,
): HistoryPoint[] {
  return Array.from({ length: count }, (_, index) => {
    /* Authored in km/h (the display default) and divided onto the m/s wire,
     * so assertions on displayed values stay round numbers. */
    const point: HistoryPoint = {
      observedAt: iso(BASE_MS - (count - 1 - index) * 5 * MINUTE_MS),
      averageMps: (10 + index) / 3.6,
      gustMps: (14 + index) / 3.6,
      lullMps: (6 + index) / 3.6,
      directionDeg: 315,
      temperatureC: 12,
    };
    return mutate ? mutate(point, index) : point;
  });
}

export function okStation(overrides: Partial<OkStation> = {}): OkStation {
  return {
    id: "test-station",
    name: "Test Station",
    sourceLabel: "WindNerd",
    pageUrl: "https://example.com/stations/test",
    latitude: 49.07,
    longitude: -117.8,
    timeZone: "America/Vancouver",
    elevationM: 1200,
    capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
    samplingWindowSeconds: 3,
    recommendedPollSeconds: 30,
    status: "ok",
    reading: {
      observedAt: iso(BASE_MS),
      averageMps: 18.4 / 3.6,
      directionDeg: 312,
      gustMps: 24.1 / 3.6,
      lullMps: 11.2 / 3.6,
      temperatureC: 14.2,
      windChillC: 10.1,
      conditions: null,
    },
    history: { periodMinutes: 5, points: makePoints(12) },
    ...overrides,
  };
}

export function downStation(overrides: Partial<DownStation> = {}): DownStation {
  return {
    id: "down-station",
    name: "Down Station",
    sourceLabel: "Campbell logger",
    pageUrl: null,
    /* Position withheld by the owner — nullable is a fact, not a shortcut. */
    latitude: null,
    longitude: null,
    timeZone: null,
    elevationM: null,
    capabilities: { gustLull: true, temperature: false, conditions: false, history: true },
    samplingWindowSeconds: null,
    recommendedPollSeconds: 60,
    status: "unavailable",
    reason: "upstream_error",
    reading: null,
    history: null,
    ...overrides,
  };
}

/* A fully reporting Tempest-shaped conditions block; override fields to null
 * to simulate dark sensors. */
export function conditionsFixture(overrides: Partial<AirConditions> = {}): AirConditions {
  return {
    dewPointC: 8.4,
    lastLightningStrikeAt: iso(BASE_MS - 47 * MINUTE_MS),
    lastLightningStrikeDistanceKm: 19,
    lightningStrikeCountLastHour: 2,
    precipitationMinutesToday: 12,
    precipitationRateMmPerHour: 0,
    precipitationTodayMm: 1.6,
    pressureTrend: "falling",
    relativeHumidityPercent: 64,
    seaLevelPressureHpa: 1012.6,
    solarRadiationWm2: 512,
    uvIndex: 6.1,
    ...overrides,
  };
}

/* A conditions-capable station: the capability flag gates AirMatrix columns. */
export function conditionsStation(overrides: Partial<OkStation> = {}): OkStation {
  const base = okStation({
    id: "conditions-station",
    name: "Conditions Station",
    sourceLabel: "WeatherFlow Tempest",
    capabilities: { gustLull: true, temperature: true, conditions: true, history: false },
    history: null,
  });
  return {
    ...base,
    reading: { ...base.reading, conditions: conditionsFixture() },
    ...overrides,
  };
}

export function feedFixture(stations: Station[] = [okStation(), downStation()]): StationFeed {
  return {
    schemaVersion: 1,
    servedAt: iso(BASE_MS + 30_000),
    primaryStationId: "test-station",
    stations,
  };
}
