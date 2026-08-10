/* <meteo-station-card>: the composite card as a compound element, the react
 * StationCard's twin. The root is a context provider (key "meteo-station-card")
 * carrying the station, the clocks, and the display settings; its pieces —
 * <meteo-station-card-header/-instrument/-chart/-summary> — read that
 * context so a page composes without re-threading attributes.
 *
 * The react children===undefined rule, translated to light DOM: an element
 * with NO authored children (whitespace-only) renders the full default
 * composition; ANY authored element child means composition mode — the
 * authored pieces move into the card's <article> and only they appear. The
 * `compose` attribute is the markup stand-in for react's
 * authored-but-empty-children edge: composition mode with nothing in it
 * renders an empty card rather than surprise-defaulting to everything.
 *
 * The <article class="meteo-station-card"> is built ONCE (children keep their
 * state — a chart pin survives the root's re-renders); only its data-status
 * tracks the station. */
import {
  freshness,
  mergeStringOverrides,
  resolveDisplay,
  resolveStrings,
  stationFreshnessThresholds,
  summaryEntries,
} from "../../index.js";
import type {
  FormatTime,
  FreshnessStatus,
  SpeedThresholds,
  SpeedUnit,
  Station,
  StationStringOverrides,
} from "../../index.js";
import { MeteoElement, MeteoStationElement } from "../lib/base.js";
import { provideContext, requestContext } from "../lib/context.js";
import type { ContextProvision } from "../lib/context.js";
import { freshnessBadgeSpan, stationNameNode } from "../lib/fragments.js";
import { h } from "../lib/h.js";
import { numberAttribute } from "../lib/attributes.js";
import { subscribeTicker } from "../lib/ticker.js";
import { CurrentConditionsElement } from "./CurrentConditionsElement.js";
import { WindHistoryChartElement } from "./WindHistoryChartElement.js";

const STATION_CARD_CONTEXT_KEY = "meteo-station-card";

type StationCardContextValue = {
  station: Station;
  servedAt: string | null;
  receivedAtMs: number | null;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  /* Ambient overrides already merged in; subcomponents merge once more. */
  strings: StationStringOverrides | undefined;
  formatTime: FormatTime;
};

export class StationCardElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "compose",
    "received-at-ms",
    "served-at",
    "station-id",
    "thresholds",
    "unit",
  ];

  #listeners = new Set<() => void>();
  #article: HTMLElement | null = null;

  protected override connected(): void {
    this.addCleanup(
      provideContext<StationCardContextValue>(this, STATION_CARD_CONTEXT_KEY, {
        getValue: () => this.#value(),
        subscribe: (listener) => {
          this.#listeners.add(listener);
          return () => this.#listeners.delete(listener);
        },
      }),
    );
  }

  #value(): StationCardContextValue {
    const station = this.requiredStation("meteo-station-card");
    const { formatTime, strings, thresholds, unit } = resolveDisplay(this.ambient(), {
      strings: this.strings,
      thresholds:
        this.thresholds !== undefined
          ? this.thresholds
          : this.#thresholdsAttribute(),
      unit: this.#unitAttribute(),
      formatTime: this.formatTime,
    });
    return {
      station,
      servedAt: this.servedAtValue(),
      receivedAtMs: this.receivedAtMsValue(),
      thresholds,
      unit,
      strings,
      formatTime,
    };
  }

  /* display() on the base would re-resolve; the two attribute readers are
   * private here so #value stays the one resolution site. */
  #unitAttribute(): SpeedUnit | undefined {
    const value = this.getAttribute("unit");
    return value === "kmh" || value === "knots" || value === "mph" || value === "mps"
      ? value
      : undefined;
  }

  #thresholdsAttribute(): SpeedThresholds | null | undefined {
    const raw = this.getAttribute("thresholds");
    if (raw == null) return undefined;
    if (raw.trim() === "none") return null;
    try {
      return JSON.parse(raw) as SpeedThresholds;
    } catch {
      return undefined;
    }
  }

  protected override render(): void {
    const value = this.#value();
    if (this.#article == null) {
      /* The composition signal is read once, at first render: any authored
       * element child or non-whitespace text (or the compose attribute)
       * means the consumer says what appears. */
      const authoredText = [...this.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      const composing = this.hasAttribute("compose") || this.children.length > 0 || authoredText;
      const article = h("article", { class: "meteo-station-card", "data-status": value.station.status });
      if (composing) {
        article.append(...this.childNodes);
      } else {
        article.append(
          document.createElement("meteo-station-card-header"),
          document.createElement("meteo-station-card-instrument"),
          document.createElement("meteo-station-card-chart"),
          document.createElement("meteo-station-card-summary"),
        );
      }
      this.#article = article;
      this.replaceChildren(article);
    } else {
      this.#article.setAttribute("data-status", value.station.status);
    }
    for (const listener of [...this.#listeners]) listener();
  }
}

/* A subcomponent outside the provider has no station to draw — that is a
 * wiring mistake, and silence would render a mystery blank. Say so. Each
 * part also accepts its own `strings` / `formatTime` properties (and the
 * instrument and chart their own thresholds/unit attributes) that override
 * the card's context — one chart can wear its own thresholds without
 * forking the card. */
abstract class StationCardPartElement extends MeteoElement {
  #context: ContextProvision<StationCardContextValue> | null = null;
  #strings: StationStringOverrides | undefined;
  #formatTime: FormatTime | undefined;
  protected abstract readonly partName: string;

  constructor() {
    super();
    for (const name of ["strings", "formatTime"]) this.upgradeProperty(name);
  }

  get strings(): StationStringOverrides | undefined {
    return this.#strings;
  }
  set strings(value: StationStringOverrides | undefined) {
    this.#strings = value;
    this.requestRender();
  }

  get formatTime(): FormatTime | undefined {
    return this.#formatTime;
  }
  set formatTime(value: FormatTime | undefined) {
    this.#formatTime = value;
    this.requestRender();
  }

  protected override connected(): void {
    this.#context = requestContext<StationCardContextValue>(this, STATION_CARD_CONTEXT_KEY);
    if (this.#context == null) {
      throw new Error(
        `<meteo-station-card-${this.partName}> must render inside <meteo-station-card> — ` +
          "the provider carries the station, clocks, and display settings.",
      );
    }
    this.addCleanup(this.#context.subscribe(() => this.requestRender()));
    this.addCleanup(() => {
      this.#context = null;
    });
  }

  /* The card's context with this part's own overrides merged in. */
  protected card(): StationCardContextValue {
    const context = this.#context;
    if (context == null) {
      throw new Error(
        `<meteo-station-card-${this.partName}> must render inside <meteo-station-card> — ` +
          "the provider carries the station, clocks, and display settings.",
      );
    }
    const value = context.getValue();
    return {
      ...value,
      strings: mergeStringOverrides(value.strings, this.#strings),
      formatTime: this.#formatTime ?? value.formatTime,
    };
  }
}

/* Identity, attribution, and the freshness badge. */
export class StationCardHeaderElement extends StationCardPartElement {
  protected override readonly partName = "header";

  protected override connected(): void {
    super.connected();
    this.addCleanup(subscribeTicker(() => this.requestRender()));
  }

  protected override render(): void {
    const { station, servedAt, receivedAtMs, strings } = this.card();
    const words = resolveStrings(strings);
    const observedAt = station.reading?.observedAt ?? null;
    const status: FreshnessStatus | null =
      observedAt == null || servedAt == null || receivedAtMs == null
        ? null
        : freshness(
            { observedAt, servedAt, receivedAtMs, nowMs: Date.now() },
            stationFreshnessThresholds(station),
          );

    this.replaceChildren(
      h(
        "header",
        { class: "meteo-station-card-header" },
        h(
          "div",
          { class: "meteo-station-card-identity" },
          h(
            "h3",
            { class: "meteo-station-card-name" },
            station.pageUrl
              ? h(
                  "a",
                  { href: station.pageUrl, rel: "noreferrer", target: "_blank" },
                  `${station.name} ↗`,
                )
              : station.name,
          ),
          h(
            "p",
            { class: "meteo-station-card-meta" },
            /* Attribution rides the header; the source label is display-only. */
            h("span", { class: "meteo-station-card-source" }, station.sourceLabel),
            station.elevationM != null &&
              h(
                "span",
                { class: "meteo-station-card-elevation" },
                ` · ${words.elevation(Math.round(station.elevationM))}`,
              ),
          ),
        ),
        status != null && freshnessBadgeSpan(status, words),
      ),
    );
  }
}

/* The dial. A page whose station table already states the current reading
 * simply leaves this piece out of its composition. */
export class StationCardInstrumentElement extends StationCardPartElement {
  static readonly observedAttributes = ["thresholds", "unit"];
  protected override readonly partName = "instrument";

  protected override render(): void {
    const context = this.card();
    const ownThresholds = partThresholds(this);
    const child = document.createElement("meteo-current-conditions") as CurrentConditionsElement;
    child.station = context.station;
    child.strings = context.strings;
    /* Pinned to null when absent: undefined would let the leaf re-consult
     * an ambient provider and undo an explicit opt-out here. */
    child.thresholds =
      (ownThresholds === undefined ? context.thresholds : (ownThresholds ?? undefined)) ?? null;
    child.formatTime = context.formatTime;
    child.servedAt = context.servedAt;
    child.receivedAtMs = context.receivedAtMs;
    child.setAttribute("unit", this.getAttribute("unit") ?? context.unit);
    this.replaceChildren(child);
  }
}

/* The part-level thresholds tri-state, read off the part's attribute with
 * the same grammar every element speaks. */
function partThresholds(part: HTMLElement): SpeedThresholds | null | undefined {
  const raw = part.getAttribute("thresholds");
  if (raw == null) return undefined;
  if (raw.trim() === "none") return null;
  try {
    return JSON.parse(raw) as SpeedThresholds;
  } catch {
    return undefined;
  }
}

export class StationCardChartElement extends StationCardPartElement {
  static readonly observedAttributes = ["plot-height", "thresholds", "unit"];
  protected override readonly partName = "chart";

  protected override render(): void {
    const context = this.card();
    const ownThresholds = partThresholds(this);
    const child = document.createElement("meteo-wind-history-chart") as WindHistoryChartElement;
    child.station = context.station;
    child.strings = context.strings;
    /* Pinned to null when absent, exactly as the instrument pins. */
    child.thresholds =
      (ownThresholds === undefined ? context.thresholds : (ownThresholds ?? undefined)) ?? null;
    child.formatTime = context.formatTime;
    child.setAttribute("unit", this.getAttribute("unit") ?? context.unit);
    const plotHeight = numberAttribute(this.getAttribute("plot-height"));
    if (plotHeight != null) child.setAttribute("plot-height", String(plotHeight));
    this.replaceChildren(child);
  }
}

/* Stats the instrument cannot measure are dropped rather than dashed: the
 * strip reads as a complete footnote, and a permanent hole says nothing. */
export class StationCardSummaryElement extends StationCardPartElement {
  protected override readonly partName = "summary";

  protected override render(): void {
    const context = this.card();
    const words = resolveStrings(context.strings);
    /* The label/value strings are the shared summaryEntries rule, so every
     * binding's strip prints the same characters over the same window. */
    const summary = summaryEntries(context.station, context.unit, words, context.formatTime);
    if (summary == null) {
      this.replaceChildren();
      return;
    }
    this.replaceChildren(
      h(
        "dl",
        {
          "aria-label": words.aria.summary(context.formatTime(new Date(summary.periodEndedAt))),
          class: "meteo-summary",
        },
        summary.entries.map((entry) =>
          h(
            "div",
            { class: "meteo-summary-item" },
            h("dt", { class: "meteo-microlabel" }, entry.label),
            h("dd", null, entry.value),
          ),
        ),
      ),
    );
  }
}
