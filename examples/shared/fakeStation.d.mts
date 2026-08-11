import type { HistoryPoint } from "@azohra/meteo/station";

export function buildLongHistory(options: {
  nowMs: number;
  days?: number;
  periodMinutes?: number;
  seed?: number;
  withGaps?: boolean;
}): HistoryPoint[];
