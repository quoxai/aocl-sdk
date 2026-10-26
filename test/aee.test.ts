import { describe, expect, it } from "vitest";
import {
  AOCL_INTENTS,
  fromEnvelope,
  isAoclIntent,
  isLayerIntent,
  layerIdForEvent,
  toEnvelope,
  toNormalizedLayer,
} from "../src/aee.js";
import type { AeeEnvelope } from "../src/types.js";

describe("AEE binding helpers", () => {
  it("emits a plain object AEE envelope with defaults (no aee-sdk import)", () => {
    const env = toEnvelope({
      id: "01X",
      ts: "2026-01-26T12:00:00Z",
      intent: AOCL_INTENTS.layerDecision,
      corr: "01AOCL_CORR_0001",
      replyTo: "01ORIGIN_TASK_0001",
      payload: { layer: { id: "L3.policy.gate", version: "0.1" } },
    });
    expect(env.from).toBe("agent.orchestrator");
    expect(env.to).toBe("log.aocl");
    expect(env.type).toBe("event");
    expect(env.priority).toBe("normal");
    expect(env.corr).toBe("01AOCL_CORR_0001");
    expect(env.reply_to).toBe("01ORIGIN_TASK_0001");
  });

  it("maps aocl.verify.result to L8.verify.check", () => {
    const env: AeeEnvelope = {
      v: "1",
      id: "01V",
      ts: "t",
      type: "event",
      from: "agent.orchestrator",
      to: "log.aocl",
      intent: AOCL_INTENTS.verifyResult,
      corr: "C",
      payload: { verification: { status: "pass" } },
    };
    expect(layerIdForEvent(env)).toBe("L8.verify.check");
    expect(toNormalizedLayer(env)!.index).toBe(8);
  });

  it("prefers explicit payload.layer.id", () => {
    const env: AeeEnvelope = {
      v: "1",
      id: "01L",
      ts: "t",
      type: "event",
      from: "a",
      to: "b",
      intent: AOCL_INTENTS.layerDecision,
      corr: "C",
      payload: { layer: { id: "L5.context.retrieve" }, timing_ms: 44 },
    };
    const ext = fromEnvelope(env);
    expect(ext.layerId).toBe("L5.context.retrieve");
    expect(ext.layerIndex).toBe(5);
    expect(ext.timing_ms).toBe(44);
  });

  it("classifies intents", () => {
    expect(isAoclIntent("aocl.layer.decision")).toBe(true);
    expect(isAoclIntent("ops.backup.status.check")).toBe(false);
    expect(isLayerIntent("aocl.layer.enter")).toBe(true);
    expect(isLayerIntent("aocl.context.patch")).toBe(true);
    expect(isLayerIntent("aocl.run.summary")).toBe(false);
  });

  it("returns null layer for non-layer envelopes", () => {
    const env: AeeEnvelope = {
      v: "1",
      id: "01T",
      ts: "t",
      type: "task",
      from: "a",
      to: "b",
      intent: "ops.backup.status.check",
      corr: "C",
      payload: {},
    };
    expect(layerIdForEvent(env)).toBeNull();
    expect(toNormalizedLayer(env)).toBeNull();
  });
});
