/* Isomorphic surface: the wire contract, pure derivations, chart geometry,
 * and the framework-free display rules (strings, formatting, air sentences,
 * merge/clock policy, endpoint routes) every binding renders from.
 * Server-only code — vendor adapters and the feed handler — lives behind
 * "@azohra/meteo/station/server" so it can never leak into a client bundle;
 * the browser-at-runtime poll loop lives behind "@azohra/meteo/station/client"
 * so this surface stays importable anywhere. */
export * from "./air.js";
export * from "./contract.js";
export * from "./derive.js";
export * from "./display.js";
export * from "./endpoints.js";
export * from "./format.js";
export * from "./geometry.js";
export * from "./instruments.js";
export * from "./mergeCurrent.js";
export * from "./strings.js";
export * from "./windnerd.js";
