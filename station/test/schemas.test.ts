/* Drift guard for schema/: the committed JSON Schemas and example documents
 * must match what the live zod contract regenerates. On failure, run
 * `pnpm build && pnpm schemas` and commit the result. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stationCurrentSchema, stationFeedSchema } from "../index.js";
import { buildSchemaDocuments } from "../../scripts/schema-documents.mjs";

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schema");

const regenerated = buildSchemaDocuments({ stationFeedSchema, stationCurrentSchema }) as Record<
  string,
  unknown
>;

function committed(filename: string): unknown {
  return JSON.parse(readFileSync(path.join(schemaDir, filename), "utf8"));
}

describe("schema/ drift", () => {
  for (const filename of Object.keys(regenerated)) {
    it(`schema/${filename} matches a regeneration from the live contract`, () => {
      expect(committed(filename)).toEqual(regenerated[filename]);
    });
  }

  it("the example feed validates against the wire contract", () => {
    expect(() => stationFeedSchema.parse(committed("example-feed.json"))).not.toThrow();
  });

  it("the example current document validates against the wire contract", () => {
    expect(() => stationCurrentSchema.parse(committed("example-current.json"))).not.toThrow();
  });
});
