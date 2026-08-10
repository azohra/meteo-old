"use client";
/* Reading-cell formatting shared by the compare table, the station strip,
 * and the text atoms: one place decides how a fragment of a reading prints —
 * the rounded speed, the em dash for an absent value, the calm word versus
 * the dead-vane dash, the linked station name — so a strip, a table row, and
 * an inline atom can never disagree. The atoms delegate their rules here and
 * add only their own inline markup (the <data> wrapper, the unit span, the
 * spoken aria). */
import type { SpeedUnit, Station } from "../../index.js";
import { compassDirection, isCalm, speedFromMps } from "../../index.js";
import { WindArrow } from "../components/WindArrow.js";
import { EM_DASH } from "./strings.js";
import type { StationStrings } from "./strings.js";

/* Display rounding: shown speeds convert to the display unit; the wire (and
 * every geometry decision) stays m/s. */
export function roundSpeed(mps: number, unit: SpeedUnit): number {
  return Math.round(speedFromMps(mps, unit));
}

/* A value the station did not report is an em dash IN PLACE, never an absent
 * cell — readings are replaced on every poll and geometry that depended on
 * which values came back non-null would twitch on every tick. */
export function optionalSpeed(mps: number | null, unit: SpeedUnit): string {
  return mps == null ? EM_DASH : String(roundSpeed(mps, unit));
}

/* The ONE temperature precision rule: one decimal, everywhere a °C prints. */
export function temperatureValue(temperatureC: number): string {
  return temperatureC.toFixed(1);
}

export function temperatureText(
  temperatureC: number | null,
  words: StationStrings,
): string {
  return temperatureC == null ? EM_DASH : `${temperatureValue(temperatureC)} ${words.degC}`;
}

/* Calm (WMO: below 0.5 m/s) withholds direction, said in a word; a null
 * bearing on a blowing reading is a broken vane and earns the dash. */
export function DirectionCell({
  averageMps,
  directionDeg,
  words,
}: {
  averageMps: number;
  directionDeg: number | null;
  words: StationStrings;
}) {
  if (isCalm(averageMps)) return <>{words.calm}</>;
  if (directionDeg == null) return <>{EM_DASH}</>;
  return (
    <>
      <WindArrow deg={directionDeg} /> {compassDirection(directionDeg)}{" "}
      {Math.round(directionDeg)}°
    </>
  );
}

/* The station's name, linked out when the station has a page of its own. */
export function StationNameLink({ station }: { station: Station }) {
  if (station.pageUrl == null) return <>{station.name}</>;
  return (
    <a href={station.pageUrl} rel="noreferrer" target="_blank">
      {station.name}
    </a>
  );
}
