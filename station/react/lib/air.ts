"use client";
/* Derivations over an AirConditions block that produce sentences, not cells:
 * the disclosure trigger's live summary and the lightning footnote. Null
 * pieces are omitted, never worded around — a summary must only claim what
 * the block actually reports. */
import type { AirConditions } from "../../index.js";
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
