"use client";
/* Consumer-vocabulary speed thresholds live in the isomorphic root
 * (station/derive.ts, next to speedToMps — they are pure unit conversion);
 * this module re-exports them so the react package's public surface is
 * unchanged and react-internal imports stay local. */
export { thresholdsToMps } from "../../derive.js";
export type { SpeedThresholds } from "../../derive.js";
