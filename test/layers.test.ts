import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYERS,
  getLayer,
  getLayerByIndex,
  isCanonicalLayer,
  layerIndex,
} from "../src/layers.js";

describe("canonical layer taxonomy", () => {
  it("has 11 layers L0..L10 in numeric order", () => {
    expect(CANONICAL_LAYERS).toHaveLength(11);
    expect(CANONICAL_LAYERS.map((l) => l.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("matches the spec ids exactly", () => {
    expect(CANONICAL_LAYERS.map((l) => l.id)).toEqual([
      "L0.ingress.normalize",
      "L1.identity.scope",
      "L2.route.smart",
      "L3.policy.gate",
      "L4.plan.decompose",
      "L5.context.retrieve",
      "L6.shape.rewrite",
      "L7.delegate.execute",
      "L8.verify.check",
      "L9.assemble.respond",
      "L10.audit.writeback",
    ]);
  });

  it("orders L10 after L9 by index, not lexically", () => {
    expect(getLayerByIndex(10)!.id).toBe("L10.audit.writeback");
    expect(layerIndex("L10.audit.writeback")).toBe(10);
    expect(layerIndex("L9.assemble.respond")).toBe(9);
    expect(layerIndex("L10.audit.writeback")! > layerIndex("L9.assemble.respond")!).toBe(true);
  });

  it("recognises canonical ids and rejects others", () => {
    expect(isCanonicalLayer("L3.policy.gate")).toBe(true);
    expect(isCanonicalLayer("L99.made.up")).toBe(false);
    expect(getLayer("L3.policy.gate")!.name).toBe("policy.gate");
    expect(getLayer("nope")).toBeUndefined();
  });

  it("returns null index for non-layer ids", () => {
    expect(layerIndex("BR.realtime_alert")).toBeNull();
    expect(layerIndex("garbage")).toBeNull();
  });
});
