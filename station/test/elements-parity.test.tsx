// @vitest-environment jsdom
/* The "neither binding is truth" enforcement: the same fixtures rendered by
 * the react binding and the elements binding must produce the same DOM —
 * the class vocabulary is versioned public API bound to one stylesheet, so
 * a divergence here is a break in one binding or the other.
 *
 * normalize(): clone, unwrap every meteo-* host (display:contents erases
 * their boxes, so unwrapping yields the layout-effective tree), canonicalize
 * generated ids (react's useId vs our counters) and their url(#…)/aria
 * references, merge adjacent text nodes, and serialize with sorted
 * attributes. Interactive states are excluded here and covered behaviorally
 * in elements-chart.test.ts. */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { defaultStrings } from "../index.js";
import type { Station } from "../index.js";
import {
  AirMatrix,
  BandChip,
  CurrentConditions,
  DailyPattern,
  Dial,
  Direction,
  FreshnessBadge,
  Gust,
  Lull,
  Pressure,
  Speed,
  Sparkline,
  StationStrip,
  StationTable,
  Temperature,
  TrendChart,
  UpdatedAt,
  WindArrow,
  WindHistoryChart,
  WindRose,
  StationCard,
} from "../react/index.js";
import { defineMeteoElements } from "../elements/index.js";
import {
  BASE_MS,
  conditionsFixture,
  conditionsStation,
  downStation,
  feedFixture,
  iso,
  makePoints,
  okStation,
} from "./fixtures.js";

defineMeteoElements();

/* ---------- the normalizer ---------- */

function unwrapHosts(root: Element): void {
  for (const host of [...root.querySelectorAll("*")]) {
    if (host.localName.startsWith("meteo-")) host.replaceWith(...host.childNodes);
  }
}

/* Every id these components carry is generated (react useId vs our
 * counters), so all of them canonicalize — in document order — along with
 * every url(#…) and whole-value (aria-controls, aria-labelledby) reference. */
function canonicalizeIds(root: Element): void {
  const mapping = new Map<string, string>();
  for (const carrier of [...root.querySelectorAll("[id]")]) {
    const id = carrier.getAttribute("id") as string;
    const canonical = mapping.get(id) ?? `generated-${mapping.size}`;
    mapping.set(id, canonical);
    carrier.setAttribute("id", canonical);
  }
  if (mapping.size === 0) return;
  for (const element of [...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value;
      for (const [before, after] of mapping) {
        if (value === before) value = after;
        value = value.replaceAll(`url(#${before})`, `url(#${after})`);
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return JSON.stringify((node as Text).data);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  const attrs = [...element.attributes]
    .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
    .sort()
    .join(" ");
  const children = [...element.childNodes].map(serializeNode).join("");
  return `<${element.localName}${attrs ? ` ${attrs}` : ""}>${children}</${element.localName}>`;
}

/* Serialize the CHILDREN of the given root — the react container div and a
 * meteo host both wrap the same layout-effective tree. */
function normalize(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  const wrapper = document.createElement("div");
  wrapper.append(...clone.childNodes);
  unwrapHosts(wrapper);
  canonicalizeIds(wrapper);
  wrapper.normalize();
  return [...wrapper.childNodes].map(serializeNode).join("");
}

/* ---------- the harness ---------- */

type AnyElement = HTMLElement & Record<string, unknown>;

function renderBoth(
  react: ReactElement,
  tag: string,
  setup?: (element: AnyElement) => void,
): { reactDom: string; elementDom: string } {
  const { container } = render(react);
  const element = document.createElement(tag) as AnyElement;
  setup?.(element);
  document.body.appendChild(element);
  const result = { reactDom: normalize(container), elementDom: normalize(element) };
  element.remove();
  return result;
}

function expectParity(
  react: ReactElement,
  tag: string,
  setup?: (element: AnyElement) => void,
): void {
  const { reactDom, elementDom } = renderBoth(react, tag, setup);
  expect(elementDom).toBe(reactDom);
  expect(elementDom.length).toBeGreaterThan(0);
}

const calmStation = (): Station =>
  okStation({
    reading: { ...okStation().reading, averageMps: 0.2, directionDeg: null, gustMps: 0.4 },
  });

const gapStation = (): Station =>
  okStation({
    history: {
      periodMinutes: 10,
      points: makePoints(8).map((point, index) =>
        index < 4
          ? point
          : { ...point, observedAt: iso(Date.parse(point.observedAt) + 3_600_000) },
      ),
    },
  });

const thresholds = { unit: "kmh" as const, values: [12, 20, 28] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS + 90_000);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/* ---------- leaves ---------- */

describe("parity: visual atoms", () => {
  it("WindArrow", () => {
    expectParity(<WindArrow deg={312} />, "meteo-wind-arrow", (el) =>
      el.setAttribute("deg", "312"),
    );
    expectParity(<WindArrow deg={12} size={20} />, "meteo-wind-arrow", (el) => {
      el.setAttribute("deg", "12");
      el.setAttribute("size", "20");
    });
  });

  it("FreshnessBadge", () => {
    for (const status of ["live", "aging", "stale"] as const) {
      expectParity(<FreshnessBadge status={status} />, "meteo-freshness-badge", (el) =>
        el.setAttribute("status", status),
      );
    }
  });

  it("Dial — ok, banded, calm, unavailable", () => {
    expectParity(<Dial station={okStation()} />, "meteo-dial", (el) => {
      el.station = okStation();
    });
    expectParity(
      <Dial station={okStation()} thresholds={thresholds} unit="knots" />,
      "meteo-dial",
      (el) => {
        el.station = okStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
        el.setAttribute("unit", "knots");
      },
    );
    expectParity(<Dial station={calmStation()} />, "meteo-dial", (el) => {
      el.station = calmStation();
    });
    expectParity(<Dial calmWord={false} station={calmStation()} />, "meteo-dial", (el) => {
      el.station = calmStation();
      el.setAttribute("no-calm-word", "");
    });
    expectParity(<Dial station={downStation()} />, "meteo-dial", (el) => {
      el.station = downStation();
    });
  });

  it("Sparkline — plain, banded, band off, gaps, no history", () => {
    expectParity(<Sparkline station={okStation()} />, "meteo-sparkline", (el) => {
      el.station = okStation();
    });
    expectParity(
      <Sparkline station={okStation()} thresholds={thresholds} />,
      "meteo-sparkline",
      (el) => {
        el.station = okStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    expectParity(<Sparkline showBand={false} station={gapStation()} />, "meteo-sparkline", (el) => {
      el.station = gapStation();
      el.setAttribute("no-band", "");
    });
    expectParity(<Sparkline station={downStation()} />, "meteo-sparkline", (el) => {
      el.station = downStation();
    });
  });

  it("WindRose — ok, thresholds, favorable ring, no history", () => {
    const favorable = [{ fromDeg: 260, toDeg: 340 }];
    expectParity(<WindRose station={okStation()} />, "meteo-wind-rose", (el) => {
      el.station = okStation();
    });
    expectParity(
      <WindRose favorableDirections={favorable} station={okStation()} thresholds={thresholds} />,
      "meteo-wind-rose",
      (el) => {
        el.station = okStation();
        el.favorableDirections = favorable;
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    expectParity(<WindRose points={makePoints(6)} />, "meteo-wind-rose", (el) => {
      el.points = makePoints(6);
    });
    expectParity(<WindRose station={downStation()} />, "meteo-wind-rose", (el) => {
      el.station = downStation();
    });
  });
});

describe("parity: text atoms", () => {
  const stations: Array<[string, () => Station]> = [
    ["ok", okStation],
    ["down", downStation],
    ["calm", calmStation],
    ["conditions", conditionsStation],
  ];

  it("Speed / Gust / Lull", () => {
    for (const [, make] of stations) {
      expectParity(<Speed station={make()} />, "meteo-speed", (el) => {
        el.station = make();
      });
      expectParity(<Gust station={make()} unit="knots" />, "meteo-gust", (el) => {
        el.station = make();
        el.setAttribute("unit", "knots");
      });
      expectParity(<Lull station={make()} />, "meteo-lull", (el) => {
        el.station = make();
      });
    }
  });

  it("Temperature / Pressure / Direction", () => {
    for (const [, make] of stations) {
      expectParity(<Temperature station={make()} />, "meteo-temperature", (el) => {
        el.station = make();
      });
      expectParity(<Pressure station={make()} />, "meteo-pressure", (el) => {
        el.station = make();
      });
      expectParity(<Direction station={make()} />, "meteo-direction", (el) => {
        el.station = make();
      });
    }
  });

  it("UpdatedAt — relative, server-anchored, unavailable", () => {
    expectParity(
      <UpdatedAt receivedAtMs={BASE_MS + 60_000} servedAt={iso(BASE_MS + 30_000)} station={okStation()} />,
      "meteo-updated-at",
      (el) => {
        el.station = okStation();
        el.setAttribute("served-at", iso(BASE_MS + 30_000));
        el.setAttribute("received-at-ms", String(BASE_MS + 60_000));
      },
    );
    expectParity(<UpdatedAt station={downStation()} />, "meteo-updated-at", (el) => {
      el.station = downStation();
    });
  });

  it("BandChip — graded, labelled, calm, ungradeable", () => {
    expectParity(<BandChip station={okStation()} thresholds={thresholds} />, "meteo-band-chip", (el) => {
      el.station = okStation();
      el.setAttribute("thresholds", JSON.stringify(thresholds));
    });
    const labels = ["light", "soarable", "strong", "nuking"];
    expectParity(
      <BandChip labels={labels} station={okStation()} thresholds={thresholds} />,
      "meteo-band-chip",
      (el) => {
        el.station = okStation();
        el.labels = labels;
        el.setAttribute("thresholds", JSON.stringify(thresholds));
      },
    );
    expectParity(<BandChip station={calmStation()} thresholds={thresholds} />, "meteo-band-chip", (el) => {
      el.station = calmStation();
      el.setAttribute("thresholds", JSON.stringify(thresholds));
    });
    expectParity(<BandChip station={okStation()} />, "meteo-band-chip", (el) => {
      el.station = okStation();
    });
  });
});

describe("parity: composites", () => {
  const servedAt = iso(BASE_MS + 30_000);
  const receivedAtMs = BASE_MS + 60_000;

  it("CurrentConditions — ok, banded, calm, wind-only, unavailable", () => {
    const windOnly = () =>
      okStation({
        capabilities: { ...okStation().capabilities, gustLull: false, temperature: false },
      });
    for (const make of [okStation, calmStation, windOnly, downStation]) {
      expectParity(
        <CurrentConditions
          receivedAtMs={receivedAtMs}
          servedAt={servedAt}
          station={make()}
          thresholds={thresholds}
          unit="knots"
        />,
        "meteo-current-conditions",
        (el) => {
          el.station = make();
          el.setAttribute("served-at", servedAt);
          el.setAttribute("received-at-ms", String(receivedAtMs));
          el.setAttribute("thresholds", JSON.stringify(thresholds));
          el.setAttribute("unit", "knots");
        },
      );
    }
  });

  it("StationStrip — ok and unavailable", () => {
    for (const make of [okStation, downStation, calmStation]) {
      expectParity(
        <StationStrip receivedAtMs={receivedAtMs} servedAt={servedAt} station={make()} />,
        "meteo-station-strip",
        (el) => {
          el.station = make();
          el.setAttribute("served-at", servedAt);
          el.setAttribute("received-at-ms", String(receivedAtMs));
        },
      );
    }
  });

  it("StationTable — default meta, custom stationMeta, degraded row", () => {
    const stations = [okStation(), downStation()];
    expectParity(
      <StationTable receivedAtMs={receivedAtMs} servedAt={servedAt} stations={stations} />,
      "meteo-station-table",
      (el) => {
        el.stations = stations;
        el.setAttribute("served-at", servedAt);
        el.setAttribute("received-at-ms", String(receivedAtMs));
      },
    );
    const meta = (station: Station) => (station.status === "ok" ? "past 3 s" : null);
    expectParity(
      <StationTable
        receivedAtMs={receivedAtMs}
        servedAt={servedAt}
        stationMeta={meta}
        stations={stations}
      />,
      "meteo-station-table",
      (el) => {
        el.stations = stations;
        el.stationMeta = meta;
        el.setAttribute("served-at", servedAt);
        el.setAttribute("received-at-ms", String(receivedAtMs));
      },
    );
  });

  it("AirMatrix — collapsed, and empty without conditions-capable stations", () => {
    const stations = [conditionsStation(), okStation(), downStation()];
    expectParity(<AirMatrix stations={stations} />, "meteo-air-matrix", (el) => {
      el.stations = stations;
    });
    /* No capable station renders nothing in both bindings. */
    const { reactDom, elementDom } = renderBoth(
      <AirMatrix stations={[downStation()]} />,
      "meteo-air-matrix",
      (el) => {
        el.stations = [downStation()];
      },
    );
    expect(reactDom).toBe("");
    expect(elementDom).toBe("");
  });

  it("AirMatrix — expanded panels match after a click on each binding's trigger", () => {
    const stations = [conditionsStation()];
    const { container } = render(<AirMatrix stations={stations} />);
    fireEvent.click(container.querySelector("button.meteo-air-trigger") as HTMLButtonElement);

    const element = document.createElement("meteo-air-matrix") as AnyElement;
    element.stations = stations;
    document.body.appendChild(element);
    (element.querySelector("button.meteo-air-trigger") as HTMLButtonElement).click();

    expect(normalize(element)).toBe(normalize(container));
    expect(normalize(element)).toContain('data-expanded="true"');
    element.remove();
  });
});

describe("parity: charts (fallback width, initial render)", () => {
  it("WindHistoryChart — plain, banded in knots, calm, thin history, no capability", () => {
    expectParity(<WindHistoryChart station={okStation()} />, "meteo-wind-history-chart", (el) => {
      el.station = okStation();
    });
    expectParity(
      <WindHistoryChart station={okStation()} thresholds={thresholds} unit="knots" />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = okStation();
        el.setAttribute("thresholds", JSON.stringify(thresholds));
        el.setAttribute("unit", "knots");
      },
    );
    expectParity(
      <WindHistoryChart plotHeight={200} station={gapStation()} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = gapStation();
        el.setAttribute("plot-height", "200");
      },
    );
    const calmHistory = () =>
      okStation({
        history: {
          periodMinutes: 10,
          points: makePoints(6).map((point) => ({
            ...point,
            averageMps: 0,
            gustMps: 0.2,
            lullMps: 0,
            directionDeg: null,
          })),
        },
      });
    expectParity(<WindHistoryChart station={calmHistory()} />, "meteo-wind-history-chart", (el) => {
      el.station = calmHistory();
    });
    const thin = () => okStation({ history: { periodMinutes: 10, points: makePoints(1) } });
    expectParity(<WindHistoryChart station={thin()} />, "meteo-wind-history-chart", (el) => {
      el.station = thin();
    });
    const noHistoryCapability = () =>
      okStation({
        capabilities: { ...okStation().capabilities, history: false },
      });
    const { reactDom, elementDom } = renderBoth(
      <WindHistoryChart station={noHistoryCapability()} />,
      "meteo-wind-history-chart",
      (el) => {
        el.station = noHistoryCapability();
      },
    );
    expect(reactDom).toBe("");
    expect(elementDom).toBe("");
  });

  it("TrendChart — temperature, pressure (not measured), thin history", () => {
    expectParity(
      <TrendChart series="temperature" station={okStation()} />,
      "meteo-trend-chart",
      (el) => {
        el.station = okStation();
        el.setAttribute("series", "temperature");
      },
    );
    /* makePoints carries no pressure: "not measured here" in both. */
    expectParity(
      <TrendChart series="pressure" station={okStation()} />,
      "meteo-trend-chart",
      (el) => {
        el.station = okStation();
        el.setAttribute("series", "pressure");
      },
    );
    const thin = () => okStation({ history: { periodMinutes: 10, points: makePoints(1) } });
    expectParity(<TrendChart series="temperature" station={thin()} />, "meteo-trend-chart", (el) => {
      el.station = thin();
      el.setAttribute("series", "temperature");
    });
  });

  it("DailyPattern — from a station (coverage caption, void slots), and from raw points", () => {
    /* Two days at one sample every 3 hours: every slot but one gets two
     * samples, the last is left short of a second day's worth — a real void
     * slot to exercise the hatch, and a true coverage fraction from the
     * station's own periodMinutes. */
    const dailyPatternStation = () =>
      okStation({
        history: {
          periodMinutes: 180,
          points: makePoints(15).map((point, index) => ({
            ...point,
            observedAt: iso(BASE_MS - (15 - index) * 3 * 3_600_000),
          })),
        },
      });
    expectParity(<DailyPattern station={dailyPatternStation()} />, "meteo-daily-pattern", (el) => {
      el.station = dailyPatternStation();
    });
    expectParity(
      <DailyPattern
        slotMinutes={60}
        station={dailyPatternStation()}
        thresholds={thresholds}
        unit="knots"
      />,
      "meteo-daily-pattern",
      (el) => {
        el.station = dailyPatternStation();
        el.setAttribute("slot-minutes", "60");
        el.setAttribute("thresholds", JSON.stringify(thresholds));
        el.setAttribute("unit", "knots");
      },
    );
    /* Raw points carry no station cadence: the caption falls back to a
     * plain sample count instead of a fraction, in both bindings alike. */
    expectParity(<DailyPattern points={makePoints(20)} />, "meteo-daily-pattern", (el) => {
      el.points = makePoints(20);
    });
    const { reactDom, elementDom } = renderBoth(
      <DailyPattern points={[]} />,
      "meteo-daily-pattern",
      (el) => {
        el.points = [];
      },
    );
    expect(reactDom).toBe(elementDom);
    expect(reactDom).toContain(defaultStrings.noHistory);
  });
});

describe("parity: the StationCard compound", () => {
  const servedAt = iso(BASE_MS + 30_000);
  const receivedAtMs = BASE_MS + 60_000;

  it("default composition — the full card, ok and unavailable", () => {
    for (const make of [okStation, downStation]) {
      expectParity(
        <StationCard
          receivedAtMs={receivedAtMs}
          servedAt={servedAt}
          station={make()}
          thresholds={thresholds}
          unit="knots"
        />,
        "meteo-station-card",
        (el) => {
          el.station = make();
          el.setAttribute("served-at", servedAt);
          el.setAttribute("received-at-ms", String(receivedAtMs));
          el.setAttribute("thresholds", JSON.stringify(thresholds));
          el.setAttribute("unit", "knots");
        },
      );
    }
  });

  it("composed subset — only the asked-for pieces, with a part-level thresholds opt-out", () => {
    const { container } = render(
      <StationCard
        receivedAtMs={receivedAtMs}
        servedAt={servedAt}
        station={okStation()}
        thresholds={thresholds}
      >
        <StationCard.Header />
        <StationCard.Chart thresholds={null} />
        <StationCard.Summary />
      </StationCard>,
    );

    const element = document.createElement("meteo-station-card") as AnyElement;
    element.innerHTML =
      "<meteo-station-card-header></meteo-station-card-header>" +
      '<meteo-station-card-chart thresholds="none"></meteo-station-card-chart>' +
      "<meteo-station-card-summary></meteo-station-card-summary>";
    element.station = okStation();
    element.setAttribute("served-at", servedAt);
    element.setAttribute("received-at-ms", String(receivedAtMs));
    element.setAttribute("thresholds", JSON.stringify(thresholds));
    document.body.appendChild(element);

    expect(normalize(element)).toBe(normalize(container));
    /* The opt-out took: no zone tinting anywhere in the card. */
    expect(normalize(element)).not.toContain("meteo-wind-zone");
    element.remove();
  });

  it("authored-but-empty means an empty card, not the default composition", () => {
    const { container } = render(
      <StationCard station={okStation()}>{false}</StationCard>,
    );
    const element = document.createElement("meteo-station-card") as AnyElement;
    element.setAttribute("compose", "");
    element.station = okStation();
    document.body.appendChild(element);
    expect(normalize(element)).toBe(normalize(container));
    expect(normalize(element)).not.toContain("meteo-station-card-header");
    element.remove();
  });
});

describe("parity: ambient defaults flow alike", () => {
  it("a provider's unit and thresholds grade both bindings identically", async () => {
    const feed = feedFixture([conditionsStation(), downStation()]);
    const { StationFeedProvider } = await import("../react/index.js");
    const { container } = render(
      <StationFeedProvider
        feed={feed}
        receivedAtMs={BASE_MS + 60_000}
        thresholds={thresholds}
        unit="knots"
      >
        <Speed />
        <BandChip />
      </StationFeedProvider>,
    );

    const provider = document.createElement("meteo-station-feed") as AnyElement;
    provider.feed = feed;
    provider.receivedAtMs = BASE_MS + 60_000;
    provider.thresholds = thresholds;
    provider.setAttribute("unit", "knots");
    provider.innerHTML = "<meteo-speed></meteo-speed><meteo-band-chip></meteo-band-chip>";
    document.body.appendChild(provider);

    expect(normalize(provider)).toBe(normalize(container));
  });
});
