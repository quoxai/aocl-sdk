/**
 * Adversarial-audit regression suite.
 *
 * Each block corresponds to a finding from the hostile-trace audit
 * (attack1_normalizer / attack2_schema / attack3_parity). The normalizer and
 * validators must degrade to findings, never throw, and must accept the real
 * QuoxCORE collector emission shape.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, beforeAll, vi } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  normalizeTrace,
  normalizeAll,
  parseNdjson,
} from "../src/normalize.js";
import { validateStack } from "../src/stack.js";
import { loadSchema } from "../src/schema.js";
import { LayerTracer } from "../src/tracer.js";
import type { AeeEnvelope } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

function layerEvent(id: string, over: Partial<AeeEnvelope> = {}): AeeEnvelope {
  return {
    v: "1",
    id: `EV_${id}`,
    ts: "2026-01-26T12:00:00Z",
    type: "event",
    from: "agent.orchestrator",
    to: "log.aocl",
    intent: "aocl.layer.decision",
    corr: "C",
    reply_to: null,
    priority: "normal",
    payload: { layer: { id }, decisions: [], control: { halt_pipeline: false } },
    ...over,
  };
}

// ── MAJOR-1: crash on hostile NDJSON ──────────────────────────────────────
describe("MAJOR-1: hostile NDJSON never throws", () => {
  it("does not throw on a null line (JSON null) via normalizeAll", () => {
    const { events } = parseNdjson('null\n' + JSON.stringify(layerEvent("L0.ingress.normalize")));
    expect(() => normalizeAll(events)).not.toThrow();
    const traces = normalizeAll(events);
    expect(traces.some((t) => t.findings.some((f) => f.reason === "malformed_event"))).toBe(true);
  });

  it("does not throw on a null event passed straight to normalizeTrace", () => {
    const evs = [null as unknown as AeeEnvelope, layerEvent("L0.ingress.normalize")];
    expect(() => normalizeTrace(evs, "C")).not.toThrow();
    const t = normalizeTrace(evs, "C");
    expect(t.findings.some((f) => f.reason === "malformed_event")).toBe(true);
  });

  it("does not throw on a layer-intent event with a missing payload", () => {
    const bad = layerEvent("L0.ingress.normalize");
    delete (bad as { payload?: unknown }).payload;
    expect(() => normalizeTrace([bad], "C")).not.toThrow();
    const t = normalizeTrace([bad], "C");
    expect(t.valid).toBe(false);
    expect(t.findings.some((f) => f.reason === "malformed_event")).toBe(true);
  });

  it("does not throw on a null payload", () => {
    const bad = layerEvent("L0.ingress.normalize", { payload: null as unknown as Record<string, unknown> });
    expect(() => normalizeTrace([bad], "C")).not.toThrow();
    const t = normalizeTrace([bad], "C");
    expect(t.findings.some((f) => f.reason === "malformed_event")).toBe(true);
  });
});

// ── MAJOR-2: collector emission shape + unresolved/unknown layers ──────────
describe("MAJOR-2: accepts the QuoxCORE collector emission shape", () => {
  // Faithful to services/collector/lib/aoclPipeline.js: payload.layer is the
  // STRING "L1"/"L3"/"L8" and the intent is aocl.layer.<id>.<verb>.
  function collectorEnvelope(
    lid: string,
    verb: string,
    over: Partial<AeeEnvelope> = {},
  ): AeeEnvelope {
    return {
      v: "1",
      id: `ENV_${lid}_${verb}`.toUpperCase(),
      ts: "2026-01-26T12:00:00Z",
      type: verb === "reject" ? "error" : "event",
      from: "system.aocl",
      to: "human.adam",
      intent: `aocl.layer.${lid}.${verb}`,
      corr: "COLLECTOR_CORR_0001",
      reply_to: null,
      priority: "normal",
      payload: { layer: lid, agent: "quox", orgId: "org1" },
      ...over,
    };
  }

  it("normalizes a full collector trace with a POLICY_DENY, valid + non-empty", () => {
    const events: AeeEnvelope[] = [
      collectorEnvelope("L1", "complete", {
        payload: { layer: "L1", agent: "quox", orgId: "org1", decisions: [{ code: "SCOPED", reason: "identity ok" }] },
      }),
      collectorEnvelope("L3", "reject", {
        payload: {
          layer: "L3",
          agent: "quox",
          orgId: "org1",
          decisions: [{ code: "POLICY_DENY", reason: "compliance policy violation" }],
        },
      }),
      // payload.layer absent: layer id must be derived from the intent verb form.
      collectorEnvelope("L8", "complete", {
        payload: { agent: "quox", orgId: "org1", decisions: [{ code: "VERIFIED", reason: "evidence present" }] },
      }),
    ];
    const t = normalizeTrace(events, "COLLECTOR_CORR_0001");
    expect(t.valid).toBe(true);
    expect(t.layers.length).toBe(3);
    expect(t.layers.map((l) => l.index)).toEqual([1, 3, 8]);
    const denies = t.layers.flatMap((l) => l.decisions).filter((d) => d.code === "POLICY_DENY");
    expect(denies).toHaveLength(1);
    expect(t.layers[0]!.decisions[0]!.code).toBe("SCOPED");
    // The L8 layer id was derived purely from the intent.
    expect(t.layers[2]!.index).toBe(8);
  });

  it("string payload.layer resolves as a layer id", () => {
    const t = normalizeTrace([layerEvent("x", { payload: { layer: "L2" } })], "C");
    expect(t.layers.map((l) => l.index)).toEqual([2]);
  });
});

describe("MAJOR-2: unresolved + unknown layer findings (no silent drop)", () => {
  it("flags a layer-intent event with no resolvable layer as an error (strict)", () => {
    const ev = layerEvent("x", { intent: "aocl.layer.decision", payload: { decisions: [] } });
    const t = normalizeTrace([ev], "C");
    expect(t.valid).toBe(false);
    expect(t.findings.some((f) => f.code === "unresolved_layer_event")).toBe(true);
  });

  it("downgrades unresolved_layer_event to a warning in lenient mode", () => {
    const ev = layerEvent("x", { intent: "aocl.layer.decision", payload: { decisions: [] } });
    const t = normalizeTrace([ev], "C", { lenient: true });
    expect(t.valid).toBe(true);
    expect(t.findings.some((f) => f.code === "unresolved_layer_event" && f.severity === "warning")).toBe(true);
  });

  it("flags an unknown non-L-prefixed id as a warning, not a silent drop", () => {
    const t = normalizeTrace([layerEvent("totally.bogus.layer")], "C");
    expect(t.findings.some((f) => f.code === "unknown_layer" && f.severity === "warning")).toBe(true);
    expect(t.valid).toBe(true);
  });

  it("accepts a custom id declared in the active stack (custom-and-fine)", () => {
    const stack = {
      stack_id: "custom",
      version: "0.1",
      mode: "pipeline" as const,
      layers: [{ id: "myco.ingest.step" }],
    };
    const t = normalizeTrace([layerEvent("myco.ingest.step")], "C", { stack });
    expect(t.findings.some((f) => f.code === "unknown_layer")).toBe(false);
  });
});

// ── MAJOR-3: schema/validator parity ──────────────────────────────────────
describe("MAJOR-3: hand validator vs ajv-on-schema parity (14 probes)", () => {
  let vStack: ValidateFunction;
  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    vStack = ajv.compile(loadSchema("stack"));
  });

  const probes: Array<[string, unknown]> = [
    ["custom-layer-id", { stack_id: "x", version: "0.1", mode: "pipeline", layers: [{ id: "myco.ingest.step" }] }],
    ["hyphen-layer-name", { stack_id: "x", version: "0.1", mode: "pipeline", layers: [{ id: "L3.policy.gate-two" }] }],
    ["uppercase-name", { stack_id: "x", version: "0.1", mode: "pipeline", layers: [{ id: "L3.Policy.Gate" }] }],
    ["empty-layers", { stack_id: "x", version: "0.1", mode: "pipeline", layers: [] }],
    ["dag-no-edges", { stack_id: "x", version: "0.1", mode: "dag", nodes: [{ id: "L0.ingress.normalize" }] }],
    ["mode-typo", { stack_id: "x", version: "0.1", mode: "Pipeline", layers: [{ id: "L0.ingress.normalize" }] }],
    ["extra-top-key", { stack_id: "x", version: "0.1", mode: "pipeline", layers: [{ id: "L0.ingress.normalize" }], evil_extra: 1 }],
    ["layer-extra-key", { stack_id: "x", version: "0.1", mode: "pipeline", layers: [{ id: "L0.ingress.normalize", note: "hi" }] }],
    ["dangling-edge", { stack_id: "x", version: "0.1", mode: "dag", nodes: [{ id: "L0.ingress.normalize" }], edges: [{ from: "L0.ingress.normalize", to: "BR.ghost" }] }],
    ["bad-enabled-type", { stack_id: "x", version: "0.1", mode: "pipeline", layers: [{ id: "L0.ingress.normalize", enabled: "yes" }] }],
    ["negative-index-L-1", { stack_id: "x", version: "0.1", mode: "dag", nodes: [{ id: "L-1.evil.layer" }], edges: [] }],
    ["spec-example-realtime-alert", JSON.parse(fixture("realtime-alert.json"))],
    ["spec-example-restricted-textonly", JSON.parse(fixture("restricted-textonly.json"))],
    ["fixture-default-dag", JSON.parse(fixture("default-dag.json"))],
  ];

  for (const [name, stack] of probes) {
    it(`agrees on ${name}`, () => {
      const hand = validateStack(stack).valid;
      const schema = vStack(stack);
      expect(schema).toBe(hand);
    });
  }
});

// ── MINORS ────────────────────────────────────────────────────────────────
describe("MINOR (c): conflicting duplicate decisions", () => {
  it("keeps first but flags conflicting decisions and invalidates", () => {
    const a = layerEvent("L3.policy.gate", { id: "A", payload: { layer: { id: "L3.policy.gate" }, decisions: [{ code: "POLICY_ALLOW", reason: "x" }] } });
    const b = layerEvent("L3.policy.gate", { id: "B", payload: { layer: { id: "L3.policy.gate" }, decisions: [{ code: "POLICY_DENY", reason: "y" }] } });
    const t = normalizeTrace([a, b], "C");
    expect(t.layers[0]!.decisions[0]!.code).toBe("POLICY_ALLOW");
    expect(t.findings.some((f) => f.code === "conflicting_layer_decision")).toBe(true);
    expect(t.valid).toBe(false);
  });

  it("keeps duplicate as a warning when decisions match", () => {
    const a = layerEvent("L1.identity.scope", { id: "A", payload: { layer: { id: "L1.identity.scope" }, decisions: [{ code: "SCOPED", reason: "x" }] } });
    const b = layerEvent("L1.identity.scope", { id: "B", payload: { layer: { id: "L1.identity.scope" }, decisions: [{ code: "SCOPED", reason: "x" }] } });
    const t = normalizeTrace([a, b], "C");
    expect(t.findings.some((f) => f.code === "duplicate_layer")).toBe(true);
    expect(t.valid).toBe(true);
  });
});

describe("MINOR (d): timestamp chronology", () => {
  it("warns on out-of-chronology layers even when index order is fine", () => {
    const evs = [
      layerEvent("L0.ingress.normalize", { ts: "2026-07-25T00:00:09Z" }),
      layerEvent("L1.identity.scope", { ts: "2026-07-25T00:00:01Z" }),
    ];
    const t = normalizeTrace(evs, "C");
    expect(t.findings.some((f) => f.code === "out_of_chronology" && f.severity === "warning")).toBe(true);
    expect(t.valid).toBe(true);
  });
});

describe("MINOR (e): normalizeAll is linear in event count", () => {
  it("normalizes 10k events across 10k corrs under 1s", () => {
    const evs: AeeEnvelope[] = [];
    for (let i = 0; i < 10000; i += 1) {
      evs.push(layerEvent("L0.ingress.normalize", { corr: `CORR_UNIQ_${i}` }));
    }
    const t0 = Date.now();
    const traces = normalizeAll(evs);
    const ms = Date.now() - t0;
    expect(traces).toHaveLength(10000);
    expect(ms).toBeLessThan(1000);
  });
});

describe("MINOR (b): tracer enforces corr minLength >= 8", () => {
  it("pads a short corr and round-trips through the trace schema", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = new LayerTracer({ corr: "abc" });
    const ev = t.layerDecision("L3.policy.gate");
    expect(ev.corr.length).toBeGreaterThanOrEqual(8);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const vTrace = ajv.compile(loadSchema("traceEvent"));
    expect(vTrace(ev)).toBe(true);
  });

  it("still throws on an empty corr", () => {
    expect(() => new LayerTracer({ corr: "" })).toThrow();
  });
});

describe("MINOR (f): trace schema timing_ms minimum + context.patch", () => {
  let vTrace: ValidateFunction;
  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    vTrace = ajv.compile(loadSchema("traceEvent"));
  });

  const base = () => JSON.parse(
    fixture("backup-check.ndjson").split("\n").filter((l) => l.trim())[2]!,
  );

  it("rejects negative timing_ms", () => {
    const ev = base();
    ev.payload.timing_ms = -5;
    expect(vTrace(ev)).toBe(false);
  });

  it("requires a layer for aocl.context.patch (consistent with the normalizer)", () => {
    const ev = base();
    ev.intent = "aocl.context.patch";
    delete ev.payload.layer;
    expect(vTrace(ev)).toBe(false);
  });
});
