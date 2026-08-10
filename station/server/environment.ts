/* The station capability's server environment is the shared core one — see
 * core/environment.ts for the core/ convention (no package export entry;
 * siblings share via relative imports). This module re-exports everything so
 * the public "@azohra/meteo/station/server" surface is unchanged. */
export * from "../../core/environment.js";

import type { UpstreamFailureReason } from "../../core/environment.js";
import type { UnavailableReason } from "../contract.js";

/* Compile-time only: core deliberately does not import the station contract,
 * so the failure-reason vocabulary is duplicated there. This alias stops
 * compiling the moment a core reason falls outside the wire's
 * UNAVAILABLE_REASONS — the two lists may not drift apart. */
type AssertCoreReasonsAreWireReasons<T extends UnavailableReason> = T;
export type _CoreReasonsAreWireReasons = AssertCoreReasonsAreWireReasons<UpstreamFailureReason>;
