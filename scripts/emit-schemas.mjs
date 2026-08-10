/* Regenerates schema/ from the built dist: JSON Schema for the two wire
 * documents plus the annotated example documents. Run `pnpm build` first,
 * then `pnpm schemas`; the drift test (station/test/schemas.test.ts) fails
 * when the committed files no longer match the live contract. */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildSchemaDocuments, renderSchemaDocument } from "./schema-documents.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let contract;
try {
  contract = await import(path.join(repoRoot, "dist/station/index.js"));
} catch (error) {
  console.error("emit-schemas: could not import dist/station/index.js — run `pnpm build` first.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { stationFeedSchema, stationCurrentSchema } = contract;
const documents = buildSchemaDocuments({ stationFeedSchema, stationCurrentSchema });

/* The examples must be valid wire documents, or they teach the wrong shape. */
stationFeedSchema.parse(documents["example-feed.json"]);
stationCurrentSchema.parse(documents["example-current.json"]);

const schemaDir = path.join(repoRoot, "schema");
await mkdir(schemaDir, { recursive: true });
for (const [filename, document] of Object.entries(documents)) {
  await writeFile(path.join(schemaDir, filename), renderSchemaDocument(document), "utf8");
  console.log(`emit-schemas: wrote schema/${filename}`);
}
