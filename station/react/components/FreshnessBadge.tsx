"use client";
/* A dot and a word. The data-freshness attribute carries the state so CSS can
 * colour it, and the word carries it so colour is never the only signal. */
import { resolveDisplay } from "../../index.js";
import type { FreshnessStatus } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { useStationFeedContext } from "./StationFeedProvider.js";

export function FreshnessBadge({
  status,
  strings,
}: {
  status: FreshnessStatus;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const { words } = resolveDisplay(context, { strings });
  return (
    <span className="meteo-freshness" data-freshness={status}>
      <span aria-hidden="true" className="meteo-freshness-dot" />
      {words.freshness[status]}
    </span>
  );
}
