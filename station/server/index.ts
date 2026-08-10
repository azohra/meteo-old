/* Server-only surface: injected environment, station configuration, vendor
 * adapters, and the mountable feed handler. Kept behind "@azohra/meteo/station/server"
 * so none of it can leak into a client bundle. */
export * from "./environment.js";
export * from "./config.js";
export * from "./adapter.js";
export * from "./feed.js";
export * from "./handler.js";
export {
  loadWindnerdStation,
  parseWindnerdRecords,
  windnerdHistoryPoints,
  type WindnerdAdapterOptions,
  type WindnerdRecords,
} from "./adapters/windnerd.js";
export {
  loadTempestStation,
  parseTempestWind,
  type TempestAdapterOptions,
  type TempestObservation,
} from "./adapters/tempest.js";
export {
  CAMPBELL_FIELD_CONTRACTS,
  loadCampbellCurrent,
  loadCampbellStation,
  naiveLocalToIso,
  parseCampbellCurrent,
  parseCampbellHistory,
  parseCampbellTable,
  type CampbellAdapterOptions,
  type CampbellTable,
  type CampbellTableExpectation,
} from "./adapters/campbell.js";
