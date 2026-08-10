/* <meteo-air-matrix>: humidity through lightning behind a live disclosure,
 * the react AirMatrix's twin over the shared airRows spec. Capability gates
 * structure: stations without the conditions capability are omitted
 * entirely; a capable station whose sensor is dark keeps its column and
 * wears em dashes cell by cell; rows exist only where at least one station
 * reports the field. The trigger line carries live values (the shared
 * airSummary) so the fold cannot be mistaken for missing data. The expanded
 * state is the element's own; the panel stays mounted (hidden) so
 * aria-controls always points at something real. */
import { EM_DASH, airRows, airSummary, lastStrikeWords, requireResolved } from "../../index.js";
import type { Station } from "../../index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";

/* useId's job without react: a stable aria wiring id per element instance. */
let panelCounter = 0;

export class AirMatrixElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at"];

  #stations: readonly Station[] | undefined;
  #expanded = false;
  readonly #panelId = `meteo-air-e${++panelCounter}`;

  constructor() {
    super();
    this.upgradeProperty("stations");
  }

  get stations(): readonly Station[] | undefined {
    return this.#stations;
  }
  set stations(value: readonly Station[] | undefined) {
    this.#stations = value;
    this.requestRender();
  }

  protected override render(): void {
    const stations = requireResolved(
      "meteo-air-matrix",
      "stations",
      this.#stations ?? this.ambient()?.feed?.stations,
      ELEMENTS_AMBIENT_HINT,
    );
    const { formatTime, words } = this.display();
    const expanded = this.#expanded;

    const capable = stations.filter((station) => station.capabilities.conditions);
    /* No capable station: the fleet has no such sensors — render nothing
     * rather than an empty shell. */
    if (capable.length === 0) {
      this.replaceChildren();
      return;
    }

    /* The trigger summary and the strike sentence speak for the first
     * station actually reporting a conditions block right now. */
    const firstConditions =
      capable
        .map((station) => station.reading?.conditions ?? null)
        .find((conditions) => conditions != null) ?? null;

    /* Feels-like is the one row read off the reading rather than the
     * conditions block, so it is filtered on its own. */
    const feelsLikeRow = capable.some((station) => station.reading?.windChillC != null);
    const rows = airRows(words).filter((row) =>
      capable.some((station) => {
        const conditions = station.reading?.conditions;
        return conditions != null && row.value(conditions) != null;
      }),
    );

    const gridTemplateColumns = `minmax(7.5rem, 1.4fr) repeat(${capable.length}, minmax(4.5rem, 1fr))`;
    const rowStyled = (element: HTMLElement): HTMLElement => {
      element.style.gridTemplateColumns = gridTemplateColumns;
      return element;
    };
    const cell = (value: string | null): HTMLElement =>
      h("span", { class: "meteo-air-cell", role: "cell" }, value ?? EM_DASH);

    this.replaceChildren(
      h(
        "section",
        { class: "meteo-air", "data-expanded": String(expanded) },
        h(
          "button",
          {
            "aria-controls": this.#panelId,
            "aria-expanded": String(expanded),
            class: "meteo-air-trigger",
            onclick: () => {
              this.#expanded = !this.#expanded;
              this.requestRender();
            },
            type: "button",
          },
          h("strong", { class: "meteo-air-title" }, words.air.title),
          h(
            "span",
            { class: "meteo-air-summary" },
            firstConditions == null
              ? words.air.summaryFallback
              : airSummary(firstConditions, words),
          ),
        ),
        /* Kept mounted so aria-controls always points at something real; the
         * hidden attribute is the fold. */
        h(
          "div",
          { class: "meteo-air-panel", hidden: !expanded, id: this.#panelId },
          h(
            "div",
            { "aria-label": words.aria.air(capable.length), class: "meteo-air-matrix", role: "table" },
            rowStyled(
              h(
                "div",
                { class: "meteo-air-row meteo-air-head", role: "row" },
                /* Empty corner header keeps AT column counts aligned. */
                h("span", { class: "meteo-air-corner", role: "columnheader" }),
                capable.map((station) =>
                  h("span", { class: "meteo-microlabel", role: "columnheader" }, station.name),
                ),
              ),
            ),
            feelsLikeRow &&
              rowStyled(
                h(
                  "div",
                  { class: "meteo-air-row", role: "row" },
                  h(
                    "span",
                    { class: "meteo-air-label", role: "rowheader" },
                    words.air.feelsLike,
                    h("small", null, words.degC),
                  ),
                  capable.map((station) =>
                    cell(station.reading?.windChillC?.toFixed(1) ?? null),
                  ),
                ),
              ),
            rows.map((row) =>
              rowStyled(
                h(
                  "div",
                  { class: "meteo-air-row", role: "row" },
                  h(
                    "span",
                    { class: "meteo-air-label", role: "rowheader" },
                    row.label,
                    h("small", null, row.unit),
                  ),
                  capable.map((station) => {
                    const conditions = station.reading?.conditions;
                    return cell(conditions == null ? null : row.value(conditions));
                  }),
                ),
              ),
            ),
          ),
          h(
            "p",
            { class: "meteo-air-note" },
            firstConditions == null
              ? words.air.noStrike
              : lastStrikeWords(firstConditions, formatTime, words),
          ),
        ),
      ),
    );
  }
}
