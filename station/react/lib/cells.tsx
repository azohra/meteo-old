"use client";
/* Reading-cell markup shared by the station table, the station strip, and
 * the text atoms. The RULES — rounding, dashing, calm-vs-dash — live in the
 * isomorphic station root (station/format.ts) so every binding prints the
 * same characters; this module holds only the react markup fragments (the
 * arrow glyph beside a bearing, the linked station name). */
import { EM_DASH, directionCell } from "../../index.js";
import type { Station, StationStrings } from "../../index.js";
import { WindArrow } from "../components/WindArrow.js";

/* Calm (WMO: below 0.5 m/s) withholds direction, said in a word; a null
 * bearing on a blowing reading is a broken vane and earns the dash. The
 * decision is the shared directionCell rule; only the arrow glyph is ours. */
export function DirectionCell({
  averageMps,
  directionDeg,
  words,
}: {
  averageMps: number;
  directionDeg: number | null;
  words: StationStrings;
}) {
  const cell = directionCell(averageMps, directionDeg);
  if (cell.kind === "calm") return <>{words.calm}</>;
  if (cell.kind === "dash") return <>{EM_DASH}</>;
  return (
    <>
      <WindArrow deg={cell.deg} /> {cell.compass} {cell.rounded}°
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
