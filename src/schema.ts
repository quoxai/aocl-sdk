/**
 * Access to the vendored JSON Schemas.
 *
 * The schemas live under schemas/ in this repo and are proposed-for-upstream
 * (aocl v0.2 roadmap: "Schemas & Validators"). They are authored from the spec
 * prose + examples, not from any pre-existing schema (the aocl spec repo has no
 * schemas/ directory at v0.1). This module only RESOLVES their paths and loads
 * them as objects; @quox/aocl deliberately ships no JSON Schema validator in
 * core (zero runtime deps). Validate with your own validator (e.g. ajv) or use
 * the zero-dep structural checks in stack.ts / normalize.ts.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// dist/schema.js -> ../schemas ; src/schema.ts -> ../schemas
const SCHEMA_DIR = join(here, "..", "schemas");

export const SCHEMA_FILES = {
  stack: "aocl-stack.schema.json",
  traceEvent: "aocl-trace-event.schema.json",
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

/** Absolute path to a vendored schema file. */
export function schemaPath(name: SchemaName): string {
  return join(SCHEMA_DIR, SCHEMA_FILES[name]);
}

/** Load a vendored schema as a parsed object. */
export function loadSchema(name: SchemaName): Record<string, unknown> {
  return JSON.parse(readFileSync(schemaPath(name), "utf8")) as Record<string, unknown>;
}
