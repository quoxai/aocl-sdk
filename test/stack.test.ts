import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadStack, validateStack } from "../src/stack.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

describe("validateStack: example stacks", () => {
  it("accepts realtime-alert.json (pipeline)", () => {
    const res = validateStack(loadStack(fixture("realtime-alert.json")));
    expect(res.valid).toBe(true);
    expect(res.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("accepts restricted-textonly.json (pipeline)", () => {
    const res = validateStack(loadStack(fixture("restricted-textonly.json")));
    expect(res.valid).toBe(true);
  });

  it("accepts default-dag.json (dag with BR nodes)", () => {
    const res = validateStack(loadStack(fixture("default-dag.json")));
    expect(res.valid).toBe(true);
    expect(res.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("validateStack: rejections", () => {
  it("requires stack_id, version, mode", () => {
    const res = validateStack({});
    const codes = res.findings.map((f) => f.code);
    expect(res.valid).toBe(false);
    expect(codes).toContain("missing_stack_id");
    expect(codes).toContain("missing_version");
    expect(codes).toContain("bad_mode");
  });

  it("requires a non-empty layers array for pipelines", () => {
    const res = validateStack({ stack_id: "x", version: "0.1", mode: "pipeline" });
    expect(res.valid).toBe(false);
    expect(res.findings.map((f) => f.code)).toContain("missing_layers");
  });

  it("requires nodes and edges for dags", () => {
    const res = validateStack({ stack_id: "x", version: "0.1", mode: "dag" });
    expect(res.valid).toBe(false);
    const codes = res.findings.map((f) => f.code);
    expect(codes).toContain("missing_nodes");
    expect(codes).toContain("missing_edges");
  });

  it("warns (not errors) on non-canonical layer ids", () => {
    const res = validateStack({
      stack_id: "x",
      version: "0.1",
      mode: "pipeline",
      layers: [{ id: "L99.custom.thing" }],
    });
    expect(res.valid).toBe(true);
    expect(res.findings.map((f) => f.code)).toContain("unknown_layer");
  });

  it("throws on malformed JSON via loadStack", () => {
    expect(() => loadStack("{not json")).toThrow();
  });
});
