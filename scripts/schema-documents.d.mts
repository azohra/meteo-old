/* Hand-written surface for schema-documents.mjs, which stays plain JS so the
 * emit script can run against dist without a build step of its own. */
import type { ZodType } from "zod";

export declare function buildSchemaDocuments(schemas: {
  stationFeedSchema: ZodType;
  stationCurrentSchema: ZodType;
}): Record<string, unknown>;

export declare function renderSchemaDocument(document: unknown): string;
