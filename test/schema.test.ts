/**
 * Validates every example file from the aocl spec repo against the vendored,
 * proposed-for-upstream JSON Schemas. If an example fails, either the schema or
 * the spec example is wrong; the failure message here is the reconciliation
 * signal. (At authoring time, all examples pass; see the report.)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { loadSchema } from "../src/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

let validateStackSchema: ValidateFunction;
let validateTraceSchema: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  validateStackSchema = ajv.compile(loadSchema("stack"));
  validateTraceSchema = ajv.compile(loadSchema("traceEvent"));
});

describe("aocl-stack.schema.json vs example stack files", () => {
  for (const file of ["realtime-alert.json", "restricted-textonly.json", "default-dag.json"]) {
    it(`validates ${file}`, () => {
      const data = JSON.parse(fixture(file));
      const ok = validateStackSchema(data);
      if (!ok) console.error(file, validateStackSchema.errors);
      expect(ok).toBe(true);
    });
  }

  it("allows unknown top-level keys (spec is open; matches validateStack)", () => {
    // stacks.md §1: the format is intentionally open. Extra config keys are
    // permitted, so the schema uses additionalProperties:true, agreeing with the
    // hand-rolled validateStack which ignores unknown keys.
    const ok = validateStackSchema({
      stack_id: "x",
      version: "0.1",
      mode: "pipeline",
      layers: [{ id: "L0.ingress.normalize" }],
      bogus: true,
    });
    expect(ok).toBe(true);
  });

  it("rejects a pipeline missing layers", () => {
    expect(validateStackSchema({ stack_id: "x", version: "0.1", mode: "pipeline" })).toBe(false);
  });
});

describe("aocl-trace-event.schema.json vs backup-check.ndjson", () => {
  it("validates every one of the 14 envelope lines", () => {
    const lines = fixture("backup-check.ndjson")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(14);
    for (const line of lines) {
      const data = JSON.parse(line);
      const ok = validateTraceSchema(data);
      if (!ok) console.error(data.id, validateTraceSchema.errors);
      expect(ok).toBe(true);
    }
  });

  it("requires payload.layer.id for aocl.layer.* intents", () => {
    const bad = {
      v: "1",
      id: "01BAD_EVENT_0001",
      ts: "2026-01-26T12:00:00Z",
      type: "event",
      from: "agent.orchestrator",
      to: "log.aocl",
      intent: "aocl.layer.decision",
      corr: "01AOCL_CORR_0001",
      reply_to: "01ORIGIN_TASK_0001",
      priority: "normal",
      payload: { run_id: "RUN-1" },
    };
    expect(validateTraceSchema(bad)).toBe(false);
  });
});
