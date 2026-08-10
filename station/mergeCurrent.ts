/* Fold a light /current response into the last full feed: the matching
 * station's reading and meta advance while its history stays put.
 *
 * A current response that says unavailable — or names a station absent from
 * the feed — does not erase the last validated reading: keep-last is the
 * client's degradation policy, and `merged` says whether anything advanced.
 *
 * Field preservation: the light endpoint may not carry the slow-moving
 * extras — temperatureC, windChillC, conditions — so a null there against a
 * prior non-null value means "not carried on this endpoint", not "the sensor
 * went dark". Those three fields keep the feed's prior values when the
 * current reading nulls them. Wind fields (averageMps, directionDeg, gustMps,
 * lullMps, observedAt) always come from current: they are what the endpoint
 * exists to refresh, and null wind fields are real facts (calm withholds
 * direction; a gustless instrument reports null).
 *
 * Freshness pairing: when merged is true, pair the returned feed with the
 * current response's receivedAtMs (servedAt advanced to the current
 * response's clock). When merged is false nothing advanced — keep the
 * PREVIOUS receivedAtMs, or freshness would credit a dead station with a
 * response it never produced. foldCurrent applies that clock rule; the
 * React useStation hook and the elements feed store both call it. */
import type { Reading, StationCurrent, StationFeed } from "./contract.js";

export type MergeResult = { feed: StationFeed; merged: boolean };

/* Nulls in the incoming reading yield to prior non-null values for the
 * fields the light endpoint omits; everything else is current's. */
function preserveOmitted(incoming: Reading, prior: Reading | null): Reading {
  if (prior == null) return incoming;
  return {
    ...incoming,
    temperatureC: incoming.temperatureC ?? prior.temperatureC,
    windChillC: incoming.windChillC ?? prior.windChillC,
    conditions: incoming.conditions ?? prior.conditions,
  };
}

export function mergeCurrent(feed: StationFeed, current: StationCurrent): MergeResult {
  const incoming = current.station;
  if (incoming.status !== "ok") return { feed, merged: false };
  if (!feed.stations.some((station) => station.id === incoming.id)) {
    return { feed, merged: false };
  }
  return {
    feed: {
      ...feed,
      servedAt: current.servedAt,
      stations: feed.stations.map((station) => {
        if (station.id !== incoming.id) return station;
        const prior = station.status === "ok" ? station : null;
        return {
          ...incoming,
          reading: preserveOmitted(incoming.reading, prior?.reading ?? null),
          history: prior?.history ?? null,
        };
      }),
    },
    merged: true,
  };
}

/* The merge with its clock rule applied, in one place: when the current
 * response merged, the pair is (merged feed, current receivedAtMs); when
 * merged is false — or there is no current at all — nothing advanced, so the
 * feed keeps its OWN receivedAtMs rather than crediting a dead station with
 * a response it never produced. */
export function foldCurrent(
  feed: StationFeed | null,
  feedReceivedAtMs: number | null,
  current: StationCurrent | null,
  currentReceivedAtMs: number | null,
): { feed: StationFeed | null; receivedAtMs: number | null } {
  if (feed == null) return { feed: null, receivedAtMs: null };
  if (current == null) return { feed, receivedAtMs: feedReceivedAtMs };
  const result = mergeCurrent(feed, current);
  return {
    feed: result.feed,
    receivedAtMs: result.merged ? currentReceivedAtMs : feedReceivedAtMs,
  };
}
