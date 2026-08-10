/* The lifecycle every meteo element shares. A host renders the exact DOM the
 * react binding renders — the same classes, the same structure, because the
 * stylesheet's class vocabulary is versioned public API — and erases its own
 * box with `display: contents`, so layout cannot tell the two bindings
 * apart.
 *
 * Rendering is SYNCHRONOUS: connect, attribute change, and property set all
 * re-render in place. A poll tick re-rendering a subtree of this size is
 * cheap, and synchronous renders mean a wiring mistake (no resolvable
 * station) throws where the consumer acted, exactly as the react binding
 * throws during render — never silently, never later.
 *
 * On connect the element requests the ambient station-feed context
 * (lib/context.ts) and re-renders on its changes; on disconnect every
 * registered cleanup runs, so no timer, observer, or subscription outlives
 * the element. Properties assigned before the element was defined are
 * captured by upgradeProperty (the standard lazy-upgrade pattern). */
import {
  freshness,
  requireResolved,
  resolveDisplay,
  resolveStation,
  stationFreshnessThresholds,
} from "../../index.js";
import type {
  FormatTime,
  FreshnessStatus,
  ResolvedDisplay,
  SpeedThresholds,
  Station,
  StationStringOverrides,
} from "../../index.js";
import { ELEMENTS_AMBIENT_HINT, STATION_FEED_CONTEXT_KEY } from "./ambient.js";
import type { AmbientStationFeed } from "./ambient.js";
import { numberAttribute, parseThresholdsAttribute, unitAttribute } from "./attributes.js";
import { requestContext } from "./context.js";
import type { ContextProvision } from "./context.js";
import { subscribeTicker } from "./ticker.js";

export abstract class MeteoElement extends HTMLElement {
  #cleanups: Array<() => void> = [];
  #ambient: ContextProvision<AmbientStationFeed> | null = null;

  connectedCallback(): void {
    /* Custom-element reactions can fire stale: a child moved between
     * parents during another element's render receives its queued
     * connectedCallback while already detached again. Skip it — the real
     * insertion queues a fresh one. */
    if (!this.isConnected) return;
    this.style.display = "contents";
    this.#ambient = requestContext<AmbientStationFeed>(this, STATION_FEED_CONTEXT_KEY);
    if (this.#ambient != null) {
      this.addCleanup(this.#ambient.subscribe(() => this.requestRender()));
    }
    this.connected();
    this.requestRender();
  }

  disconnectedCallback(): void {
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#ambient = null;
    this.disconnected();
  }

  attributeChangedCallback(_name: string, _oldValue: string | null, _newValue: string | null): void {
    this.requestRender();
  }

  /* Re-render now (connected elements only — a detached element has no
   * ambient context to render from yet). */
  requestRender(): void {
    if (!this.isConnected) return;
    this.render();
  }

  protected ambient(): AmbientStationFeed | null {
    return this.#ambient?.getValue() ?? null;
  }

  /* Registered teardowns run once, on disconnect. */
  protected addCleanup(cleanup: () => void): void {
    this.#cleanups.push(cleanup);
  }

  /* The standard lazy-upgrade pattern: a property assigned before
   * defineMeteoElements() ran landed as an own data property shadowing the
   * class accessor; re-route it through the setter. Subclasses call this in
   * their constructor for each accessor-backed property. */
  protected upgradeProperty(name: string): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = (this as Record<string, unknown>)[name];
      delete (this as Record<string, unknown>)[name];
      (this as Record<string, unknown>)[name] = value;
    }
  }

  /* The shared station resolution with THIS binding's wiring words: explicit
   * property → station-id attribute looked up in the ambient feed →
   * primaryStationId → stations[0]; nothing throws the shared error naming
   * <meteo-station-feed>. */
  protected resolveRequiredStation(component: string, stationProp: Station | undefined): Station {
    return requireResolved(
      component,
      "station",
      stationProp ??
        resolveStation(this.ambient()?.feed ?? null, this.getAttribute("station-id") ?? undefined),
      ELEMENTS_AMBIENT_HINT,
    );
  }

  /* Subclass hooks. */
  protected connected(): void {}
  protected disconnected(): void {}
  protected abstract render(): void;
}

/* The per-station display element: the accessor set nearly every element
 * shares — `station`, `strings`, `formatTime` as properties, `unit` and the
 * thresholds tri-state as attribute-or-property — resolved through the
 * shared resolveDisplay so this binding's precedence can never drift from
 * the react binding's. A `thresholds` PROPERTY (including an explicit null)
 * outranks the attribute; the attribute grammar (JSON / "none" / absent)
 * covers markup-only pages. */
export abstract class MeteoStationElement extends MeteoElement {
  #station: Station | undefined;
  #strings: StationStringOverrides | undefined;
  #formatTime: FormatTime | undefined;
  #thresholds: SpeedThresholds | null | undefined = undefined;
  #thresholdsSet = false;
  #servedAt: string | null | undefined = undefined;
  #receivedAtMs: number | null | undefined = undefined;

  constructor() {
    super();
    for (const name of [
      "station",
      "strings",
      "formatTime",
      "thresholds",
      "servedAt",
      "receivedAtMs",
    ]) {
      this.upgradeProperty(name);
    }
  }

  get station(): Station | undefined {
    return this.#station;
  }
  set station(value: Station | undefined) {
    this.#station = value;
    this.requestRender();
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

  get thresholds(): SpeedThresholds | null | undefined {
    return this.#thresholds;
  }
  set thresholds(value: SpeedThresholds | null | undefined) {
    this.#thresholds = value;
    this.#thresholdsSet = value !== undefined;
    this.requestRender();
  }

  protected display(): ResolvedDisplay {
    return resolveDisplay(this.ambient(), {
      strings: this.#strings,
      unit: unitAttribute(this.getAttribute("unit")),
      formatTime: this.#formatTime,
      thresholds: this.#thresholdsSet
        ? this.#thresholds
        : parseThresholdsAttribute(this.getAttribute("thresholds")),
    });
  }

  protected requiredStation(component: string): Station {
    return this.resolveRequiredStation(component, this.#station);
  }

  /* Freshness inputs: an explicit property (which may pin null) wins, then
   * the attribute, then the ambient feed; absent everywhere the badge is
   * simply withheld — null never fabricates a status. */
  get servedAt(): string | null | undefined {
    return this.#servedAt;
  }
  set servedAt(value: string | null | undefined) {
    this.#servedAt = value;
    this.requestRender();
  }

  get receivedAtMs(): number | null | undefined {
    return this.#receivedAtMs;
  }
  set receivedAtMs(value: number | null | undefined) {
    this.#receivedAtMs = value;
    this.requestRender();
  }

  protected servedAtValue(): string | null {
    if (this.#servedAt !== undefined) return this.#servedAt;
    return this.getAttribute("served-at") ?? this.ambient()?.feed?.servedAt ?? null;
  }

  protected receivedAtMsValue(): number | null {
    if (this.#receivedAtMs !== undefined) return this.#receivedAtMs;
    const attr = numberAttribute(this.getAttribute("received-at-ms"));
    return attr !== undefined ? attr : (this.ambient()?.receivedAtMs ?? null);
  }

  /* The between-polls re-judgment: elements that render freshness subscribe
   * the shared 30 s ticker via this. */
  protected watchFreshness(): void {
    this.addCleanup(subscribeTicker(() => this.requestRender()));
  }

  protected freshnessOf(station: Station): FreshnessStatus | null {
    const observedAt = station.reading?.observedAt ?? null;
    const servedAt = this.servedAtValue();
    const receivedAtMs = this.receivedAtMsValue();
    if (observedAt == null || servedAt == null || receivedAtMs == null) return null;
    return freshness(
      { observedAt, servedAt, receivedAtMs, nowMs: Date.now() },
      stationFreshnessThresholds(station),
    );
  }
}
