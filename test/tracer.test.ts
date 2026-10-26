import { describe, expect, it } from "vitest";
import { LayerTracer, TracerRegistry } from "../src/tracer.js";
import { parseNdjson } from "../src/normalize.js";

function fixedTracer(corr: string) {
  let n = 0;
  return new LayerTracer({
    corr,
    originId: "01ORIGIN_TASK_0001",
    idFactory: (seq) => `${corr}_EV_${String(seq).padStart(4, "0")}`,
    clock: () => `2026-01-26T12:00:0${(n = Math.min(n + 1, 9))}Z`,
  });
}

describe("LayerTracer", () => {
  it("emits spec-conformant AEE envelopes that re-parse cleanly", () => {
    const t = fixedTracer("01AOCL_CORR_TEST");
    t.stackSelect("default", "standard ops check", "RUN-TEST-1");
    t.layerDecision("L0.ingress.normalize", {
      timing_ms: 8,
      decisions: [{ code: "NORMALIZED", reason: "parsed" }],
    });
    t.verifyResult({ status: "pass", confidence: 0.96 });

    const ndjson = t.toNdjson();
    const { events, parseErrors } = parseNdjson(ndjson);
    expect(parseErrors).toEqual([]);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.corr === "01AOCL_CORR_TEST")).toBe(true);
    expect(events[0]!.intent).toBe("aocl.stack.select");
    expect(events[1]!.intent).toBe("aocl.layer.decision");
    expect((events[1]!.payload as any).layer.id).toBe("L0.ingress.normalize");
    // Strategy A root-linked reply chaining.
    expect(events.every((e) => e.reply_to === "01ORIGIN_TASK_0001")).toBe(true);
  });

  it("requires a corr", () => {
    expect(() => new LayerTracer({ corr: "" })).toThrow();
  });

  it("keeps per-corr state isolated (no ambient bleed)", () => {
    const a = new LayerTracer({ corr: "CORR_AAA1" });
    const b = new LayerTracer({ corr: "CORR_BBB2" });
    a.layerDecision("L0.ingress.normalize");
    b.layerDecision("L1.identity.scope");
    b.layerDecision("L3.policy.gate");
    expect(a.events()).toHaveLength(1);
    expect(b.events()).toHaveLength(2);
    expect(a.events()[0]!.corr).toBe("CORR_AAA1");
  });
});

describe("TracerRegistry", () => {
  it("is corr-keyed and reuses instances", () => {
    const reg = new TracerRegistry();
    const t1 = reg.getOrCreate({ corr: "CORR_XXX1" });
    const t2 = reg.getOrCreate({ corr: "CORR_XXX1" });
    expect(t1).toBe(t2);
    expect(reg.size()).toBe(1);
    reg.getOrCreate({ corr: "CORR_YYY2" });
    expect(reg.size()).toBe(2);
    expect(reg.get("CORR_XXX1")).toBe(t1);
    reg.delete("CORR_XXX1");
    expect(reg.get("CORR_XXX1")).toBeUndefined();
  });
});
