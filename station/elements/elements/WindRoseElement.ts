/* <meteo-wind-rose>: the react WindRose's twin over the shared rose
 * geometry (station/instruments.ts) — sixteen petals by default, each
 * petal's length the sector's share of non-calm samples, calm named in a
 * caption instead of smeared into a sector, and the favorable-directions
 * judgment ring drawn outside the grid and spoken in the aria label. */
import {
  ROSE_CARDINAL_LETTERS,
  ROSE_CENTRE,
  ROSE_FAVORABLE_RING_RADIUS,
  ROSE_HUB_DOT_RADIUS,
  ROSE_HUB_RADIUS,
  ROSE_INTERCARDINAL_BEARINGS,
  ROSE_LETTER_RADIUS,
  ROSE_MAX_RADIUS,
  ROSE_PETAL_FILL,
  ROSE_SIZE,
  ROSE_TICK_REACH,
  normalizeDegrees,
  resolveStation,
  rosePetalPath,
  rosePolar,
  roseRingArcPath,
  speedBand,
  thresholdsToMps,
  windRose,
} from "../../index.js";
import type { FavorableDirection, HistoryPoint } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

export class WindRoseElement extends MeteoStationElement {
  static readonly observedAttributes = ["sector-count", "station-id", "thresholds"];

  #points: HistoryPoint[] | undefined;
  #favorableDirections: FavorableDirection[] | undefined;

  constructor() {
    super();
    for (const name of ["points", "favorableDirections"]) this.upgradeProperty(name);
  }

  /* Used when no station is given, or the station carries no history. */
  get points(): HistoryPoint[] | undefined {
    return this.#points;
  }
  set points(value: HistoryPoint[] | undefined) {
    this.#points = value;
    this.requestRender();
  }

  get favorableDirections(): FavorableDirection[] | undefined {
    return this.#favorableDirections;
  }
  set favorableDirections(value: FavorableDirection[] | undefined) {
    this.#favorableDirections = value;
    this.requestRender();
  }

  protected override render(): void {
    /* Explicit points outrank the provider: a consumer handing raw samples
     * asked for exactly those samples. The station is optional — the aria
     * label falls back to the generic sentence. */
    const station =
      this.station ??
      (this.#points == null
        ? (resolveStation(
            this.ambient()?.feed ?? null,
            this.getAttribute("station-id") ?? undefined,
          ) ?? undefined)
        : undefined);
    const { thresholds, words } = this.display();
    const sectorCount = numberAttribute(this.getAttribute("sector-count")) ?? 16;
    const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
    const favorableDirections = this.#favorableDirections;
    const source =
      this.#points ??
      (station?.status === "ok" ? (station.history?.points ?? null) : null) ??
      [];
    if (source.length === 0) {
      this.replaceChildren(
        h("div", { class: "meteo-wind-rose meteo-wind-rose-na", role: "note" }, words.noHistory),
      );
      return;
    }

    const rose = windRose(source, sectorCount);
    const maxFrequency = Math.max(...rose.sectors.map((sector) => sector.frequency));
    const halfWidthDeg = (360 / sectorCount / 2) * ROSE_PETAL_FILL;
    const calmPercent = Math.round(rose.calmFraction * 100);
    /* The SE quadrant carries the ring label — no cardinal letter lives there. */
    const [ringLabelX, ringLabelY] = rosePolar(135, ROSE_MAX_RADIUS);
    /* The judgment ring is spoken, not just drawn: the label names the
     * favorable sectors so a screen reader gets the same verdict. */
    const favorable = favorableDirections != null && favorableDirections.length > 0;
    const baseLabel = station ? words.aria.rose(station.name) : words.aria.roseGeneric;
    const roseLabel =
      favorable && favorableDirections != null
        ? `${baseLabel} ${words.aria.roseFavorable(
            favorableDirections
              .map(
                (sector) =>
                  `${Math.round(normalizeDegrees(sector.fromDeg))}°–${Math.round(
                    normalizeDegrees(sector.toDeg),
                  )}°`,
              )
              .join(", "),
          )}`
        : baseLabel;

    this.replaceChildren(
      h(
        "div",
        { class: "meteo-wind-rose" },
        hs(
          "svg",
          {
            "aria-label": roseLabel,
            class: "meteo-wind-rose-svg",
            height: ROSE_SIZE,
            role: "img",
            viewBox: `0 0 ${ROSE_SIZE} ${ROSE_SIZE}`,
            width: ROSE_SIZE,
          },
          [1, 2 / 3, 1 / 3].map((fraction) =>
            hs("circle", {
              class: "meteo-wind-rose-grid",
              cx: ROSE_CENTRE,
              cy: ROSE_CENTRE,
              r: ROSE_MAX_RADIUS * fraction,
            }),
          ),
          /* Unfavorable is the whole ring; favorable arcs paint over it, so
           * the remainder needs no complement arithmetic. */
          favorable && favorableDirections != null
            ? [
                hs("circle", {
                  class: "meteo-wind-rose-ring-unfavorable",
                  cx: ROSE_CENTRE,
                  cy: ROSE_CENTRE,
                  r: ROSE_FAVORABLE_RING_RADIUS,
                }),
                favorableDirections.map((sector) =>
                  hs("path", { class: "meteo-wind-rose-ring-favorable", d: roseRingArcPath(sector) }),
                ),
              ]
            : null,
          ROSE_INTERCARDINAL_BEARINGS.map((bearing) => {
            const [x1, y1] = rosePolar(bearing, ROSE_MAX_RADIUS - ROSE_TICK_REACH);
            const [x2, y2] = rosePolar(bearing, ROSE_MAX_RADIUS + ROSE_TICK_REACH);
            return hs("line", { class: "meteo-wind-rose-tick", x1, x2, y1, y2 });
          }),
          ROSE_CARDINAL_LETTERS.map(({ bearing, letter }) => {
            const [x, y] = rosePolar(bearing, ROSE_LETTER_RADIUS);
            return hs(
              "text",
              { class: "meteo-wind-rose-letter", "text-anchor": "middle", x, y: y + 4 },
              letter,
            );
          }),
          rose.sectors.map((sector) => {
            if (sector.count === 0 || maxFrequency === 0) return null;
            const radius =
              ROSE_HUB_RADIUS +
              (sector.frequency / maxFrequency) * (ROSE_MAX_RADIUS - ROSE_HUB_RADIUS);
            const banded =
              boundsMps != null && sector.meanSpeedMps != null
                ? ` meteo-band-${speedBand(sector.meanSpeedMps, boundsMps)}`
                : "";
            return hs("path", {
              class: `meteo-wind-rose-petal${banded}`,
              d: rosePetalPath(sector.bearingDeg, radius, halfWidthDeg),
            });
          }),
          /* Outer grid ring named for what it means: the busiest sector's
           * share of non-calm samples. */
          maxFrequency > 0 &&
            hs(
              "text",
              {
                class: "meteo-wind-rose-ring-label",
                "text-anchor": "start",
                x: ringLabelX + 3,
                y: ringLabelY + 9,
              },
              words.percentShare(Math.round(maxFrequency * 100)),
            ),
          hs("circle", { class: "meteo-wind-rose-hub", cx: ROSE_CENTRE, cy: ROSE_CENTRE, r: ROSE_HUB_RADIUS }),
          hs("circle", { class: "meteo-wind-rose-dot", cx: ROSE_CENTRE, cy: ROSE_CENTRE, r: ROSE_HUB_DOT_RADIUS }),
        ),
        rose.calmFraction > 0
          ? h("p", { class: "meteo-wind-rose-calm" }, words.percentCalm(calmPercent))
          : null,
      ),
    );
  }
}
