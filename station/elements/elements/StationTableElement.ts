/* <meteo-station-table>: the fleet grid, the react StationTable's twin —
 * one row per station, seven columns, rows structurally fixed whatever a
 * station reports; an unavailable station keeps its row with the reason
 * words spanning the data cells. Roles are explicit because grid display
 * drops the implicit ones.
 *
 * `stationMeta` is a PROPERTY — (station) => string | Node | null — the
 * sub-label under each name (default: the source attribution; null leaves
 * the line empty, exactly as the react render prop does). */
import { optionalSpeed, requireResolved, roundSpeed, temperatureText } from "../../index.js";
import type { FormatTime, SpeedUnit, Station, StationStrings } from "../../index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import {
  directionCellNodes,
  freshnessBadgeSpan,
  stationNameNode,
} from "../lib/fragments.js";
import { h } from "../lib/h.js";

export type StationMeta = (station: Station) => string | Node | null;

export class StationTableElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at", "unit"];

  #stations: readonly Station[] | undefined;
  #stationMeta: StationMeta | undefined;

  constructor() {
    super();
    for (const name of ["stations", "stationMeta"]) this.upgradeProperty(name);
  }

  /* A fleet component takes `stations` (per-station components take
   * `station`); the ambient feed supplies them otherwise. */
  get stations(): readonly Station[] | undefined {
    return this.#stations;
  }
  set stations(value: readonly Station[] | undefined) {
    this.#stations = value;
    this.requestRender();
  }

  get stationMeta(): StationMeta | undefined {
    return this.#stationMeta;
  }
  set stationMeta(value: StationMeta | undefined) {
    this.#stationMeta = value;
    this.requestRender();
  }

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const stations = requireResolved(
      "meteo-station-table",
      "stations",
      this.#stations ?? this.ambient()?.feed?.stations,
      ELEMENTS_AMBIENT_HINT,
    );
    const { formatTime, unit, words } = this.display();

    this.replaceChildren(
      h(
        "div",
        { "aria-label": words.aria.table(stations.length), class: "meteo-station-table", role: "table" },
        h(
          "div",
          { class: "meteo-station-table-row meteo-station-table-head meteo-microlabel", role: "row" },
          h("span", { role: "columnheader" }, words.table.station),
          h("span", { role: "columnheader" }, words.table.wind),
          h("span", { role: "columnheader" }, words.table.lull),
          h("span", { role: "columnheader" }, words.table.gust),
          h("span", { role: "columnheader" }, words.table.from),
          h("span", { role: "columnheader" }, words.table.temp),
          h("span", { role: "columnheader" }, words.table.updated),
        ),
        h(
          "div",
          { class: "meteo-station-table-body", role: "rowgroup" },
          stations.map((station) => this.#row(station, unit, words, formatTime)),
        ),
      ),
    );
  }

  #row(
    station: Station,
    unit: SpeedUnit,
    words: StationStrings,
    formatTime: FormatTime,
  ): HTMLElement {
    const status = this.freshnessOf(station);
    const meta = this.#stationMeta ? this.#stationMeta(station) : station.sourceLabel;
    return h(
      "div",
      { class: "meteo-station-table-row", "data-status": station.status, role: "row" },
      h(
        "span",
        { class: "meteo-station-table-station", role: "cell" },
        h("strong", null, stationNameNode(station)),
        h("small", null, meta),
      ),
      station.status === "ok"
        ? [
            h(
              "span",
              { class: "meteo-station-table-wind", role: "cell" },
              h("strong", null, String(roundSpeed(station.reading.averageMps, unit))),
              h("small", null, words.speedUnits[unit]),
            ),
            h(
              "span",
              { class: "meteo-station-table-lull", role: "cell" },
              optionalSpeed(station.reading.lullMps, unit),
            ),
            h(
              "span",
              { class: "meteo-station-table-gust", role: "cell" },
              optionalSpeed(station.reading.gustMps, unit),
            ),
            h(
              "span",
              { class: "meteo-station-table-from", role: "cell" },
              ...directionCellNodes(station.reading.averageMps, station.reading.directionDeg, words),
            ),
            h(
              "span",
              { class: "meteo-station-table-temp", role: "cell" },
              temperatureText(station.reading.temperatureC, words),
            ),
            h(
              "span",
              { class: "meteo-station-table-updated", role: "cell" },
              h(
                "span",
                { class: "meteo-station-table-time" },
                formatTime(new Date(station.reading.observedAt)),
              ),
              status != null && freshnessBadgeSpan(status, words),
            ),
          ]
        : h("span", { class: "meteo-station-table-reason", role: "cell" }, words.reasons[station.reason]),
    );
  }
}
