/* TEXT ATOMS as custom elements: the smallest reading fragments —
 * meteo-speed, meteo-gust, meteo-lull, meteo-temperature, meteo-pressure,
 * meteo-direction, the ticking meteo-updated-at, and meteo-band-chip — the
 * react atoms' twins, rendering the identical inline markup from the same
 * shared rules (station/format.ts): a value the station cannot report is an
 * em dash IN PLACE inside the same element; calm is said in the calm word;
 * the display unit converts only what is shown while the wire value rides
 * the <data> element's `value` attribute in m/s, unrounded. */
import {
  EM_DASH,
  compassDirection,
  isCalm,
  readingAgeMs,
  roundSpeed,
  speedBand,
  speedMpsOf,
  temperatureValue,
  thresholdsToMps,
  updatedAtText,
} from "../../index.js";
import type { SpeedKind } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { directionCellNodes } from "../lib/fragments.js";
import { h } from "../lib/h.js";

const STATION_ATTRIBUTES = ["station-id", "unit"] as const;

abstract class SpeedAtomElement extends MeteoStationElement {
  static readonly observedAttributes = [...STATION_ATTRIBUTES];
  protected abstract readonly kind: SpeedKind;
  protected abstract readonly component: string;

  protected override render(): void {
    const station = this.requiredStation(this.component);
    const { unit, words } = this.display();
    const mps = speedMpsOf(station, this.kind);
    this.replaceChildren(
      h(
        "data",
        { class: "meteo-value meteo-speed", value: mps ?? undefined },
        ...(mps == null
          ? [EM_DASH]
          : [
              `${roundSpeed(mps, unit)} `,
              h("span", { class: "meteo-unit" }, words.speedUnits[unit]),
            ]),
      ),
    );
  }
}

export class SpeedElement extends SpeedAtomElement {
  protected override readonly kind = "average";
  protected override readonly component = "meteo-speed";
}

export class GustElement extends SpeedAtomElement {
  protected override readonly kind = "gust";
  protected override readonly component = "meteo-gust";
}

export class LullElement extends SpeedAtomElement {
  protected override readonly kind = "lull";
  protected override readonly component = "meteo-lull";
}

/* One decimal with the degree word, the station table's format exactly. */
export class TemperatureElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-temperature");
    const { words } = this.display();
    const celsius =
      station.status === "ok" && station.capabilities.temperature
        ? station.reading.temperatureC
        : null;
    this.replaceChildren(
      h(
        "data",
        { class: "meteo-value meteo-temperature", value: celsius ?? undefined },
        ...(celsius == null
          ? [EM_DASH]
          : [`${temperatureValue(celsius)} `, h("span", { class: "meteo-unit" }, words.degC)]),
      ),
    );
  }
}

/* Sea-level corrected pressure off the conditions block, one decimal hPa. */
export class PressureElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-pressure");
    const { words } = this.display();
    const hpa =
      station.status === "ok" && station.capabilities.conditions
        ? (station.reading.conditions?.seaLevelPressureHpa ?? null)
        : null;
    this.replaceChildren(
      h(
        "data",
        { class: "meteo-value meteo-pressure", value: hpa ?? undefined },
        ...(hpa == null
          ? [EM_DASH]
          : [`${hpa.toFixed(1)} `, h("span", { class: "meteo-unit" }, words.air.unitHpa)]),
      ),
    );
  }
}

/* Arrow glyph + compass word + degrees via the shared direction rule; the
 * aria sentence spells the point out so "NW 305°" reads as weather. */
export class DirectionElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-direction");
    const { words } = this.display();
    const reading = station.status === "ok" ? station.reading : null;
    if (reading == null) {
      this.replaceChildren(h("span", { class: "meteo-direction" }, EM_DASH));
      return;
    }
    const bearingDeg = isCalm(reading.averageMps) ? null : reading.directionDeg;
    const point = bearingDeg == null ? null : compassDirection(bearingDeg);
    this.replaceChildren(
      h(
        "span",
        {
          "aria-label":
            point == null || bearingDeg == null
              ? undefined
              : words.aria.direction(words.compassSpoken[point], Math.round(bearingDeg)),
          class: "meteo-direction",
        },
        ...directionCellNodes(reading.averageMps, reading.directionDeg, words),
      ),
    );
  }
}

/* Ticking relative age of the reading, re-judged on the shared 30 s ticker;
 * beyond ~6 hours it falls back to the absolute formatTime words. Age is
 * server-anchored when servedAt/receivedAtMs exist — the shared
 * readingAgeMs rule, worded by the shared updatedAtText. */
export class UpdatedAtElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at", "station-id"];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-updated-at");
    const { formatTime, words } = this.display();
    const reading = station.status === "ok" ? station.reading : null;
    if (reading == null) {
      this.replaceChildren(h("span", { class: "meteo-updated" }, EM_DASH));
      return;
    }
    const ageMs = readingAgeMs({
      observedAt: reading.observedAt,
      servedAt: this.servedAtValue(),
      receivedAtMs: this.receivedAtMsValue(),
      nowMs: Date.now(),
    });
    this.replaceChildren(
      h(
        "time",
        { class: "meteo-updated", datetime: reading.observedAt },
        updatedAtText(ageMs, reading.observedAt, words, formatTime),
      ),
    );
  }
}

/* The current reading graded against consumer thresholds, worn as a chip.
 * Calm is not graded — a band would imply flyability judgment over air that
 * is not moving; an unavailable station or no thresholds anywhere wears the
 * em dash chip, without a data-band. */
export class BandChipElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id", "thresholds", "unit"];

  #labels: readonly string[] | undefined;

  constructor() {
    super();
    this.upgradeProperty("labels");
  }

  /* One word per band, values.length + 1 entries; index = band. */
  get labels(): readonly string[] | undefined {
    return this.#labels;
  }
  set labels(value: readonly string[] | undefined) {
    this.#labels = value;
    this.requestRender();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-band-chip");
    const { thresholds, unit, words } = this.display();
    const reading = station.status === "ok" ? station.reading : null;
    if (reading != null && isCalm(reading.averageMps)) {
      this.replaceChildren(h("span", { class: "meteo-band-chip" }, words.calm));
      return;
    }
    if (reading == null || thresholds == null) {
      this.replaceChildren(h("span", { class: "meteo-band-chip" }, EM_DASH));
      return;
    }
    const band = speedBand(reading.averageMps, thresholdsToMps(thresholds));
    const label =
      this.#labels?.[band] ?? `${roundSpeed(reading.averageMps, unit)} ${words.speedUnits[unit]}`;
    this.replaceChildren(h("span", { class: "meteo-band-chip", "data-band": band }, label));
  }
}
