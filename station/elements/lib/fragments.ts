/* Shared DOM fragments: the arrow glyph, the direction cell, the linked
 * station name, and the freshness badge — the elements-binding twins of the
 * react binding's cells.tsx markup. The DECISIONS (calm vs dash vs bearing,
 * link vs text) are the station root's shared rules; only the node
 * construction is ours, and it must produce exactly the DOM the react
 * binding renders, because both feed the same stylesheet and the parity
 * suite compares them byte for byte. */
import { directionCell } from "../../index.js";
import type { FreshnessStatus, Station, StationStrings } from "../../index.js";
import { EM_DASH } from "../../index.js";
import { h, hs } from "./h.js";
import type { ElementChild } from "./h.js";

/* Tiny inline dart pointing where the wind goes — the flow (TO) convention —
 * flipped from the FROM bearing every feed reports. Rotation via the style
 * OBJECT (not the attribute) so serialization matches react's. */
export function windArrowSvg(deg: number, size = 12): SVGElement {
  const svg = hs(
    "svg",
    { "aria-hidden": "true", class: "meteo-wind-arrow", height: size, viewBox: "0 0 16 16", width: size },
    hs("path", { d: "M8 1 L13 14 L8 10.6 L3 14 Z", fill: "currentColor" }),
  );
  (svg as SVGElement & { style: CSSStyleDeclaration }).style.transform = `rotate(${deg + 180}deg)`;
  return svg;
}

/* Calm (WMO: below 0.5 m/s) withholds direction, said in a word; a null
 * bearing on a blowing reading is a broken vane and earns the dash. */
export function directionCellNodes(
  averageMps: number,
  directionDeg: number | null,
  words: StationStrings,
): ElementChild[] {
  const cell = directionCell(averageMps, directionDeg);
  if (cell.kind === "calm") return [words.calm];
  if (cell.kind === "dash") return [EM_DASH];
  return [windArrowSvg(cell.deg), ` ${cell.compass} ${cell.rounded}°`];
}

/* The station's name, linked out when the station has a page of its own. */
export function stationNameNode(station: Station): ElementChild {
  if (station.pageUrl == null) return station.name;
  return h("a", { href: station.pageUrl, rel: "noreferrer", target: "_blank" }, station.name);
}

/* A dot and a word. The data-freshness attribute carries the state so CSS
 * can colour it, and the word carries it so colour is never the only
 * signal. */
export function freshnessBadgeSpan(status: FreshnessStatus, words: StationStrings): HTMLElement {
  return h(
    "span",
    { class: "meteo-freshness", "data-freshness": status },
    h("span", { "aria-hidden": "true", class: "meteo-freshness-dot" }),
    words.freshness[status],
  );
}
