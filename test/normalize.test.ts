import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  groupByCorr,
  normalizeAll,
  normalizeTrace,
  parseNdjson,
} from "../src/normalize.js";
import { loadStack } from "../src/stack.js";
import type { AeeEnvelope } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

function layerEvent(id: string, corr = "C"): AeeEnvelope {
  return {
    v: "1",
    id: `EV_${id}`,
    ts: "2026-01-26T12:00:00Z",
    type: "event",
    from: "agent.orchestrator",
    to: "log.aocl",
    intent: "aocl.layer.decision",
    corr,
    reply_to: null,
    priority: "normal",
    payload: { layer: { id }, control: { halt_pipeline: false } },
  };
}

describe("parseNdjson truncation tolerance", () => {
  it("flags a truncated final line with a distinct reason and does not throw", () => {
    const good = fixture("backup-check.ndjson").trim();
    const truncated = good + '\n{"v":"1","id":"01PARTIAL","ts":"2026';
    const { events, parseErrors } = parseNdjson(truncated);
    expect(events).toHaveLength(14);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]!.reason).toBe("truncated_final_line");
    expect(parseErrors[0]!.severity).toBe("warning");
  });

  it("flags a mid-file bad line as an error, distinct from truncation", () => {
    const text = [JSON.stringify(layerEvent("L0.ingress.normalize")), "{bad", JSON.stringify(layerEvent("L1.identity.scope"))].join("\n");
    const { events, parseErrors } = parseNdjson(text);
    expect(events).toHaveLength(2);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]!.reason).toBe("invalid_json");
    expect(parseErrors[0]!.severity).toBe("error");
  });

  it("ignores blank/trailing lines", () => {
    const { events, parseErrors } = parseNdjson(JSON.stringify(layerEvent("L0.ingress.normalize")) + "\n\n");
    expect(events).toHaveLength(1);
    expect(parseErrors).toEqual([]);
  });
});

describe("normalizeTrace violations", () => {
  it("flags out-of-order layers as an error", () => {
    const events = [layerEvent("L3.policy.gate"), layerEvent("L1.identity.scope")];
    const t = normalizeTrace(events, "C");
    expect(t.valid).toBe(false);
    expect(t.findings.some((f) => f.code === "out_of_order")).toBe(true);
  });

  it("flags an unknown (non-canonical) layer as a warning, not a silent drop", () => {
    // Spec permits custom taxonomies, so an unknown id is a WARNING (trace stays
    // valid), reported but not placed in the ordered pipeline.
    const events = [layerEvent("L0.ingress.normalize"), layerEvent("L99.made.up")];
    const t = normalizeTrace(events, "C");
    expect(t.valid).toBe(true);
    expect(t.findings.some((f) => f.code === "unknown_layer" && f.severity === "warning")).toBe(true);
    // The unknown layer is not counted as an observed layer.
    expect(t.layers.map((l) => l.id)).toEqual(["L0.ingress.normalize"]);
  });

  it("flags duplicate layers as a warning and keeps the first", () => {
    const first = layerEvent("L1.identity.scope");
    first.id = "EV_FIRST";
    const second = layerEvent("L1.identity.scope");
    second.id = "EV_SECOND";
    const t = normalizeTrace([first, second], "C");
    expect(t.valid).toBe(true);
    expect(t.layers).toHaveLength(1);
    expect(t.layers[0]!.eventId).toBe("EV_FIRST");
    expect(t.findings.some((f) => f.code === "duplicate_layer")).toBe(true);
  });
});

describe("normalizeTrace stack-aware gaps", () => {
  it("reports enabled-but-missing layers against a stack", () => {
    const stack = loadStack(fixture("realtime-alert.json"));
    // realtime-alert enables L0,L1,L3,L7,L9,L10. Emit only L0,L1,L3.
    const events = [
      layerEvent("L0.ingress.normalize"),
      layerEvent("L1.identity.scope"),
      layerEvent("L3.policy.gate"),
    ];
    const t = normalizeTrace(events, "C", { stack });
    const missing = t.findings.filter((f) => f.code === "missing_layer").map((f) => f.layer);
    expect(missing).toContain("L7.delegate.execute");
    expect(missing).toContain("L9.assemble.respond");
    expect(missing).toContain("L10.audit.writeback");
    expect(t.stackId).toBe("realtime-alert");
  });

  it("reports layers observed but not enabled in the stack", () => {
    const stack = loadStack(fixture("realtime-alert.json"));
    const events = [layerEvent("L0.ingress.normalize"), layerEvent("L5.context.retrieve")];
    const t = normalizeTrace(events, "C", { stack });
    expect(t.findings.some((f) => f.code === "unexpected_layer" && f.layer === "L5.context.retrieve")).toBe(true);
  });
});

describe("groupByCorr / normalizeAll", () => {
  it("splits and normalizes multiple corrs", () => {
    const events = [
      layerEvent("L0.ingress.normalize", "C1"),
      layerEvent("L1.identity.scope", "C1"),
      layerEvent("L0.ingress.normalize", "C2"),
    ];
    expect(groupByCorr(events).size).toBe(2);
    const traces = normalizeAll(events);
    expect(traces).toHaveLength(2);
    expect(traces.find((t) => t.corr === "C1")!.layers).toHaveLength(2);
  });
});
