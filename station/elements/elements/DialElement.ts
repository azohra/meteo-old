/* <meteo-dial>: the gauge alone, the react Dial's twin — same shared
 * instrument geometry (station/instruments.ts), same classes, same
 * semantics: calm hides the needle while the measured speed stays in the
 * hub (the calm word rides the hub unless `no-calm-word` — a composition
 * whose own direction row states calm turns it off), unavailable greys the
 * dial and wears the reason in words. `size` scales the rendered box, never
 * the drawing math. The SVG builder is exported for CurrentConditions to
 * compose. */
import {
  DIAL_CARDINALS,
  DIAL_CARDINAL_TICK_INNER,
  DIAL_CENTRE,
  DIAL_COUNTERWEIGHT_RADIUS,
  DIAL_COUNTERWEIGHT_REACH,
  DIAL_HUB_RADIUS,
  DIAL_LETTER_RADIUS,
  DIAL_RING_RADIUS,
  DIAL_SIZE,
  DIAL_TICK_INNER,
  dialNeedlePoints,
  dialPolar,
  dialScaleMaxMps,
  dialSpeedArcPath,
  isCalm,
  roundSpeed,
  speedBand,
  thresholdsToMps,
} from "../../index.js";
import type { SpeedThresholds, SpeedUnit, Station, StationStrings } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { hs } from "../lib/h.js";

/* useId's job without react: unique url(#…)-safe ids per drawn dial. */
let bezelCounter = 0;

export function dialSvg(options: {
  station: Station;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  words: StationStrings;
  size?: number;
  calmWord?: boolean;
}): SVGElement {
  const { station, thresholds, unit, words, size = DIAL_SIZE, calmWord = true } = options;
  const shown = (averageMps: number) => roundSpeed(averageMps, unit);
  const unitLabel = words.speedUnits[unit];
  const bezelId = `meteo-bezel-e${++bezelCounter}`;
  const reading = station.status === "ok" ? station.reading : null;
  const calm = reading != null && isCalm(reading.averageMps);
  const blowing = reading != null && !calm && reading.directionDeg != null;

  const dialMax = dialScaleMaxMps(reading?.averageMps ?? null, reading?.gustMps ?? null, unit);
  const arcFraction = reading == null ? 0 : Math.min(1, Math.max(0, reading.averageMps) / dialMax);
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
  const arcBand =
    reading != null && boundsMps != null ? speedBand(reading.averageMps, boundsMps) : null;

  const dialLabel =
    station.status === "unavailable"
      ? `${station.name}: ${words.reasons[station.reason]}`
      : calm
        ? `${station.name}: ${words.calm}, ${shown(station.reading.averageMps)} ${unitLabel}`
        : `${station.name}: ${shown(station.reading.averageMps)} ${unitLabel}`;

  return hs(
    "svg",
    {
      "aria-label": dialLabel,
      class: station.status === "unavailable" ? "meteo-wind-dial meteo-wind-dial-unavailable" : "meteo-wind-dial",
      height: size,
      role: "img",
      viewBox: `0 0 ${DIAL_SIZE} ${DIAL_SIZE}`,
      width: size,
    },
    hs(
      "defs",
      null,
      /* Stop colours live in CSS so the bezel rethemes with the rest. */
      hs(
        "radialGradient",
        { cx: "50%", cy: "42%", id: bezelId, r: "68%" },
        hs("stop", { class: "meteo-wind-dial-bezel-in", offset: "55%" }),
        hs("stop", { class: "meteo-wind-dial-bezel-out", offset: "100%" }),
      ),
    ),
    hs("circle", { class: "meteo-wind-dial-face", cx: DIAL_CENTRE, cy: DIAL_CENTRE, r: DIAL_RING_RADIUS }),
    hs("circle", {
      class: "meteo-wind-dial-bezel",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      fill: `url(#${bezelId})`,
      r: DIAL_RING_RADIUS,
    }),
    hs("circle", { class: "meteo-wind-dial-ring", cx: DIAL_CENTRE, cy: DIAL_CENTRE, r: DIAL_RING_RADIUS }),
    reading != null &&
      arcFraction > 0 &&
      hs("path", {
        class: arcBand == null ? "meteo-wind-dial-arc" : `meteo-wind-dial-arc meteo-band-${arcBand}`,
        d: dialSpeedArcPath(arcFraction),
      }),
    Array.from({ length: 16 }, (_, index) => {
      const bearing = index * 22.5;
      const cardinal = index % 4 === 0;
      const [x1, y1] = dialPolar(bearing, DIAL_RING_RADIUS);
      const [x2, y2] = dialPolar(bearing, cardinal ? DIAL_CARDINAL_TICK_INNER : DIAL_TICK_INNER);
      return hs("line", {
        class: cardinal ? "meteo-wind-dial-tick meteo-wind-dial-tick-cardinal" : "meteo-wind-dial-tick",
        x1,
        x2,
        y1,
        y2,
      });
    }),
    DIAL_CARDINALS.map(({ bearing, letter }) => {
      const [x, y] = dialPolar(bearing, DIAL_LETTER_RADIUS);
      return hs("text", { class: "meteo-wind-dial-letter", "text-anchor": "middle", x, y: y + 3.5 }, letter);
    }),
    blowing &&
      reading.directionDeg != null &&
      hs(
        "g",
        { class: "meteo-wind-needle" },
        hs("polygon", { class: "meteo-wind-needle-blade", points: dialNeedlePoints(reading.directionDeg) }),
        hs("circle", {
          class: "meteo-wind-needle-counterweight",
          cx: dialPolar(reading.directionDeg, DIAL_COUNTERWEIGHT_REACH)[0],
          cy: dialPolar(reading.directionDeg, DIAL_COUNTERWEIGHT_REACH)[1],
          r: DIAL_COUNTERWEIGHT_RADIUS,
        }),
      ),
    /* The hub sits over the needle so the reading owns the centre. */
    hs("circle", { class: "meteo-wind-dial-hub", cx: DIAL_CENTRE, cy: DIAL_CENTRE, r: DIAL_HUB_RADIUS }),
    reading == null
      ? hs(
          "text",
          { class: "meteo-wind-dial-reason", "text-anchor": "middle", x: DIAL_CENTRE, y: DIAL_CENTRE + 4 },
          words.notReporting,
        )
      : [
          /* Calm withholds direction, never the measured speed — and with no
           * direction row on the bare dial, the calm word rides the hub,
           * centred above the number in the reason text's quiet voice. */
          calm && calmWord
            ? hs(
                "text",
                {
                  class: "meteo-wind-dial-reason",
                  "text-anchor": "middle",
                  x: DIAL_CENTRE,
                  y: DIAL_CENTRE - 22,
                },
                words.calm,
              )
            : null,
          hs(
            "text",
            { class: "meteo-wind-dial-speed", "text-anchor": "middle", x: DIAL_CENTRE, y: DIAL_CENTRE + 8 },
            String(shown(reading.averageMps)),
          ),
          hs(
            "text",
            { class: "meteo-wind-dial-unit", "text-anchor": "middle", x: DIAL_CENTRE, y: DIAL_CENTRE + 26 },
            unitLabel,
          ),
        ],
  );
}

export class DialElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "no-calm-word",
    "received-at-ms",
    "served-at",
    "size",
    "station-id",
    "thresholds",
    "unit",
  ];

  protected override render(): void {
    const station = this.requiredStation("meteo-dial");
    const { thresholds, unit, words } = this.display();
    this.replaceChildren(
      dialSvg({
        station,
        thresholds,
        unit,
        words,
        size: numberAttribute(this.getAttribute("size")) ?? DIAL_SIZE,
        calmWord: !this.hasAttribute("no-calm-word"),
      }),
    );
  }
}
