/* Derivations over an AirConditions block that produce sentences and row
 * specs, not markup: the disclosure trigger's live summary, the lightning
 * footnote, and the air-matrix row table. Null pieces are omitted, never
 * worded around — a summary must only claim what the block actually
 * reports. Framework-free so every binding folds the same facts into the
 * same words. */
import type { AirConditions } from "./contract.js";
import { defaultStrings } from "./strings.js";
import type { FormatTime, StationStrings } from "./strings.js";

const round1 = (value: number) => Math.round(value * 10) / 10;

/* The trigger line: humidity, rain state, lightning recency — so folding is
 * a fold and not a hiding place. Rain state prefers the live rate over the
 * day total, and "dry" is only said when the gauge reported an actual zero.
 * Everything null falls back to naming what the panel holds. */
export function airSummary(
  conditions: AirConditions,
  strings: StationStrings = defaultStrings,
): string {
  const words = strings.air;
  const rain =
    conditions.precipitationRateMmPerHour != null && conditions.precipitationRateMmPerHour > 0
      ? words.summaryRaining(round1(conditions.precipitationRateMmPerHour))
      : conditions.precipitationTodayMm == null
        ? null
        : conditions.precipitationTodayMm > 0
          ? words.summaryRainToday(round1(conditions.precipitationTodayMm))
          : words.summaryDry;
  const pieces = [
    conditions.relativeHumidityPercent == null
      ? null
      : words.summaryHumidity(Math.round(conditions.relativeHumidityPercent)),
    rain,
    conditions.lightningStrikeCountLastHour != null &&
    conditions.lightningStrikeCountLastHour > 0
      ? words.summaryStrikes(conditions.lightningStrikeCountLastHour)
      : null,
  ].filter((piece): piece is string => piece != null);
  return pieces.length > 0 ? pieces.join(" · ") : words.summaryFallback;
}

/* A sentence, not a table cell: a distance and a time are not a count and do
 * not belong in the counting column. Distance may be null independently of
 * the timestamp; the sentence says so instead of dropping the strike. */
export function lastStrikeWords(
  conditions: AirConditions,
  formatTime: FormatTime,
  strings: StationStrings = defaultStrings,
): string {
  const words = strings.air;
  if (conditions.lastLightningStrikeAt == null) return words.noStrike;
  const time = formatTime(new Date(conditions.lastLightningStrikeAt));
  return conditions.lastLightningStrikeDistanceKm == null
    ? words.lastStrikeNoDistance(time)
    : words.lastStrike(Math.round(conditions.lastLightningStrikeDistanceKm), time);
}

/* ---------- the air-matrix row table ---------- */

/* A row spec, not a row: the label, the unit word for the label column, and
 * the rule that prints a station's cell (null means "this block does not
 * report the field" and the row is a candidate for omission). */
export type AirRow = {
  label: string;
  unit: string;
  value: (conditions: AirConditions) => string | null;
};

/* Row order follows the reference discipline: body feel first, then the
 * pressure story, then sun, then water, then hazard. Feels-like rides the
 * reading, not the conditions block, so the matrix threads it in as its own
 * synthetic row. */
export function airRows(words: StationStrings): AirRow[] {
  const air = words.air;
  return [
    {
      label: air.humidity,
      unit: air.unitPercent,
      value: (c) =>
        c.relativeHumidityPercent == null ? null : `${Math.round(c.relativeHumidityPercent)}`,
    },
    {
      label: air.dewPoint,
      unit: words.degC,
      value: (c) => c.dewPointC?.toFixed(1) ?? null,
    },
    {
      label: air.pressure,
      unit: air.unitHpa,
      value: (c) => c.seaLevelPressureHpa?.toFixed(1) ?? null,
    },
    {
      /* Word cells, so the label carries no unit. */
      label: air.pressureTrend,
      unit: "",
      value: (c) =>
        c.pressureTrend === "falling"
          ? air.trendFalling
          : c.pressureTrend === "rising"
            ? air.trendRising
            : c.pressureTrend === "steady"
              ? air.trendSteady
              : null,
    },
    {
      label: air.solar,
      unit: air.unitWm2,
      value: (c) => (c.solarRadiationWm2 == null ? null : `${Math.round(c.solarRadiationWm2)}`),
    },
    {
      label: air.uv,
      unit: air.unitIndex,
      value: (c) => (c.uvIndex == null ? null : `${Math.round(c.uvIndex * 10) / 10}`),
    },
    {
      label: air.rainRate,
      unit: air.unitMmPerHour,
      value: (c) => c.precipitationRateMmPerHour?.toFixed(1) ?? null,
    },
    {
      label: air.rainToday,
      unit: air.unitMm,
      value: (c) => c.precipitationTodayMm?.toFixed(1) ?? null,
    },
    {
      label: air.rainMinutes,
      unit: air.unitMinutes,
      value: (c) =>
        c.precipitationMinutesToday == null ? null : `${c.precipitationMinutesToday}`,
    },
    {
      label: air.lightning,
      unit: air.unitStrikesPastHour,
      value: (c) =>
        c.lightningStrikeCountLastHour == null ? null : `${c.lightningStrikeCountLastHour}`,
    },
  ];
}
