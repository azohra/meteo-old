import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/* GitHub Pages serves a project site under /<repo>/, not /. Local `pnpm dev`
 * and `pnpm build` stay rooted at / by default; the Pages workflow sets
 * VITE_BASE=/meteo/ for the deployed build only. */
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
});
