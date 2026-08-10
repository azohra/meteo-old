/* <meteo-station-strip>: the per-station one-liner, the react
 * StationStrip's twin. Absent VALUES dash in place; only a CAPABILITY the
 * station lacks omits its cell; an unavailable station keeps its line — the
 * name stays, the reason words stand in for the reading cells. */
import { EM_DASH, optionalSpeed, roundSpeed, temperatureText } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import {
  directionCellNodes,
  freshnessBadgeSpan,
  stationNameNode,
} from "../lib/fragments.js";
import { h } from "../lib/h.js";
import type { ElementChild } from "../lib/h.js";

export class StationStripElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at", "station-id", "unit"];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-station-strip");
    const { formatTime, unit, words } = this.display();
    const status = this.freshnessOf(station);

    const cells: ElementChild[] =
      station.status === "ok"
        ? [
            h(
              "span",
              { class: "meteo-strip-wind" },
              h("strong", null, String(roundSpeed(station.reading.averageMps, unit))),
              h("small", null, words.speedUnits[unit]),
            ),
            station.capabilities.gustLull && [
              h(
                "span",
                { class: "meteo-strip-lull" },
                h("small", { class: "meteo-microlabel" }, words.lullLabel),
                optionalSpeed(station.reading.lullMps, unit),
              ),
              h(
                "span",
                { class: "meteo-strip-gust" },
                h("small", { class: "meteo-microlabel" }, words.gustLabel),
                optionalSpeed(station.reading.gustMps, unit),
              ),
            ],
            h(
              "span",
              { class: "meteo-strip-from" },
              ...directionCellNodes(station.reading.averageMps, station.reading.directionDeg, words),
            ),
            station.capabilities.temperature &&
              h(
                "span",
                { class: "meteo-strip-temp" },
                temperatureText(station.reading.temperatureC, words),
              ),
            h(
              "span",
              { class: "meteo-strip-updated" },
              h(
                "span",
                { class: "meteo-strip-time" },
                formatTime(new Date(station.reading.observedAt)),
              ),
              status != null && freshnessBadgeSpan(status, words),
            ),
          ]
        : [h("span", { class: "meteo-strip-reason" }, words.reasons[station.reason])];

    this.replaceChildren(
      h(
        "div",
        {
          "aria-label": words.aria.strip(station.name),
          class: "meteo-strip",
          "data-status": station.status,
          role: "group",
        },
        h("span", { class: "meteo-strip-station" }, stationNameNode(station)),
        ...cells,
      ),
    );
  }
}
