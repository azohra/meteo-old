/* The side-effectful convenience: `import "@azohra/meteo/station/elements/register"`
 * defines every meteo element on the global registry — the one-liner for a
 * <script type="module"> page. Apps that need control over timing or a
 * scoped registry import defineMeteoElements from the index instead. */
import { defineMeteoElements } from "./index.js";

defineMeteoElements();
