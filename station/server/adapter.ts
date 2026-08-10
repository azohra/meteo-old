/* defineStationAdapter: the one copy of the adapter liturgy. A vendor adapter
 * is parse + map; everything around that — resolving the environment,
 * assembling meta, the try/catch degradation belt, logUpstreamFailure, and
 * the throw → UnavailableReason mapping — exists here once. All three
 * built-in adapters are defined through it, and a third party shipping a
 * vendor package gets the same belt for free. */
import { unavailableStation, type History, type Reading, type Station, type StationMeta } from "../contract.js";
import {
  logUpstreamFailure,
  resolveEnvironment,
  unavailableReasonForError,
  type ResolvedEnvironment,
  type ServerEnvironment,
} from "./environment.js";
import { DEFAULT_HISTORY_HOURS } from "./feed.js";

export type StationAdapterMode = "full" | "current";

/* The options every adapter accepts. A vendor adapter may extend this with
 * its own fields (test-only endpoint overrides, say); the extras ride back
 * into its load callback via context.options. */
export type StationAdapterOptions = {
  historyHours?: number;
  /* "current" asks for a reading only: the belt nulls history on the ok arm
   * and the load callback may skip history work it can see coming. */
  mode?: StationAdapterMode;
  environment?: ServerEnvironment;
};

export type StationAdapterContext<O extends StationAdapterOptions = StationAdapterOptions> = {
  readonly environment: ResolvedEnvironment;
  readonly historyHours: number;
  readonly mode: StationAdapterMode;
  /* The caller's options verbatim, for adapter-specific extras. */
  readonly options: O;
};

/* What a load callback returns: the ok arm minus status and meta. The
 * optional meta partial refines the definition's meta(config) claim with what
 * the upstream reported (Tempest reports its installed position and
 * elevation) — config claims are the fallback, upstream knowledge wins. */
export type StationAdapterResult = {
  readonly reading: Reading;
  readonly history: History | null;
  readonly meta?: Partial<StationMeta>;
};

export type StationAdapterDefinition<C, O extends StationAdapterOptions = StationAdapterOptions> = {
  /* Identity and capabilities from the config claim alone — computed before
   * any I/O, because it is also the meta a degraded station wears. */
  readonly meta: (config: C) => StationMeta;
  /* Fetch, parse, map. Throw freely: every throw is belted into one degraded
   * station with unavailableReasonForError's verdict, never a rejection. */
  readonly load: (config: C, context: StationAdapterContext<O>) => Promise<StationAdapterResult>;
};

export type StationAdapter<C, O extends StationAdapterOptions = StationAdapterOptions> = (
  config: C,
  options?: O,
) => Promise<Station>;

export function defineStationAdapter<C, O extends StationAdapterOptions = StationAdapterOptions>(
  definition: StationAdapterDefinition<C, O>,
): StationAdapter<C, O> {
  return async (config, options) => {
    const resolved = options ?? ({} as O);
    const environment = resolveEnvironment(resolved.environment);
    const mode = resolved.mode ?? "full";
    const meta = definition.meta(config);
    try {
      const result = await definition.load(config, {
        environment,
        historyHours: resolved.historyHours ?? DEFAULT_HISTORY_HOURS,
        mode,
        options: resolved,
      });
      return {
        ...meta,
        ...result.meta,
        status: "ok",
        reading: result.reading,
        /* Light mode slims a load that ignored it; meta stays intact. */
        history: mode === "current" ? null : result.history,
      };
    } catch (error) {
      logUpstreamFailure(environment, `${meta.name} live wind unavailable`, error, {
        station: meta.id,
      });
      return unavailableStation(meta, unavailableReasonForError(error));
    }
  };
}
