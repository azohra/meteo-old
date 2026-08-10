/* <meteo-current-conditions>: the instrument — the shared dial SVG flanked
 * by lull and gust readouts, a direction row, a temperature row, and a
 * freshness footer; the react CurrentConditions' twin. Fixed geometry
 * throughout: rows exist whatever the reading says, absent values dash in
 * place, a lacking capability omits its row, calm is said in the direction
 * row (so the dial's own calm word is off), unavailable greys the dial and
 * wears the reason. */
import { EM_DASH, compassDirection, isCalm, roundSpeed, temperatureText, temperatureValue } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { freshnessBadgeSpan, windArrowSvg } from "../lib/fragments.js";
import { h } from "../lib/h.js";
import type { ElementChild } from "../lib/h.js";
import { dialSvg } from "./DialElement.js";

export class CurrentConditionsElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "received-at-ms",
    "served-at",
    "station-id",
    "thresholds",
    "unit",
  ];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-current-conditions");
    const { formatTime, thresholds, unit, words } = this.display();
    const reading = station.status === "ok" ? station.reading : null;
    const status = this.freshnessOf(station);
    const calm = reading != null && isCalm(reading.averageMps);
    const blowing = reading != null && !calm && reading.directionDeg != null;

    const direction: ElementChild[] =
      station.status === "unavailable"
        ? [words.reasons[station.reason]]
        : blowing && reading.directionDeg != null
          ? [
              h("span", { class: "meteo-current-from-label" }, words.fromLabel),
              " ",
              windArrowSvg(reading.directionDeg),
              " ",
              h("strong", null, compassDirection(reading.directionDeg)),
              ` ${Math.round(reading.directionDeg)}°`,
            ]
          : calm
            ? [words.calm]
            : [EM_DASH];

    this.replaceChildren(
      h(
        "div",
        {
          "aria-label": words.aria.current(station.name),
          class: "meteo-current",
          "data-status": station.status,
          role: "group",
        },
        h(
          "div",
          { class: "meteo-current-instrument" },
          station.capabilities.gustLull &&
            h(
              "div",
              { class: "meteo-current-flank meteo-current-flank-lull" },
              h("small", { class: "meteo-microlabel" }, words.lullLabel),
              h(
                "strong",
                null,
                reading?.lullMps == null ? EM_DASH : String(roundSpeed(reading.lullMps, unit)),
              ),
            ),
          /* Everything already resolved above threads through explicitly;
           * calm word off — the direction row below is this component's
           * place to say calm. */
          dialSvg({ station, thresholds, unit, words, calmWord: false }),
          station.capabilities.gustLull &&
            h(
              "div",
              { class: "meteo-current-flank meteo-current-flank-gust" },
              h("small", { class: "meteo-microlabel" }, words.gustLabel),
              h(
                "strong",
                null,
                reading?.gustMps == null ? EM_DASH : String(roundSpeed(reading.gustMps, unit)),
              ),
            ),
        ),
        h("p", { class: "meteo-current-direction" }, ...direction),
        station.capabilities.temperature &&
          h(
            "p",
            { class: "meteo-current-temp" },
            temperatureText(reading?.temperatureC ?? null, words),
            reading?.windChillC != null &&
              h(
                "span",
                { class: "meteo-current-chill" },
                ` · ${words.feelsLikeLabel} ${temperatureValue(reading.windChillC)} ${words.degC}`,
              ),
          ),
        h(
          "p",
          { class: "meteo-current-footer" },
          status != null && freshnessBadgeSpan(status, words),
          h(
            "span",
            { class: "meteo-current-observed" },
            reading == null ? EM_DASH : formatTime(new Date(reading.observedAt)),
          ),
        ),
      ),
    );
  }
}
