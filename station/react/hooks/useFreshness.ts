"use client";
/* Freshness that keeps judging between polls: a 30-second clock re-evaluates
 * the same reading, so a station that dies visibly ages while the poll loop
 * keeps returning the same last observation. Null inputs (an unavailable
 * station has no reading) yield null rather than a fabricated status.
 *
 * Hydration-deterministic: the initial clock is receivedAtMs — a prop both
 * server and client render from — never Date.now(), which differs between
 * the server pass and the client's hydration pass and could flip a status
 * across a threshold boundary. The mount effect corrects to the real clock
 * immediately; effects run only on the client, after hydration. */
import { useEffect, useState } from "react";
import { freshness } from "../../index.js";
import type { FreshnessStatus, FreshnessThresholds } from "../../index.js";

const REEVALUATE_MS = 30_000;

export function useFreshness(
  observedAt: string | null | undefined,
  servedAt: string | null | undefined,
  receivedAtMs: number | null | undefined,
  thresholds?: FreshnessThresholds,
): FreshnessStatus | null {
  const [nowMs, setNowMs] = useState(() => receivedAtMs ?? Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), REEVALUATE_MS);
    return () => window.clearInterval(timer);
  }, []);
  if (observedAt == null || servedAt == null || receivedAtMs == null) return null;
  return freshness({ observedAt, servedAt, receivedAtMs, nowMs }, thresholds);
}
