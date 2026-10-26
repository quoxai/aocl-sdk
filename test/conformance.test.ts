/**
 * External conformance vector.
 *
 * The expected NormalizedTrace below is computed BY HAND from the canonical
 * example trace aocl/examples/traces/backup-check.ndjson and asserted as a
 * literal. If the normalizer drifts, this breaks. Note the two "gap" findings:
 * the trace emits an L7 delegation as an AEE `task` envelope (not an
 * aocl.layer.* decision), and never emits an L4 or L10 layer event, so the
 * normalizer honestly reports index 4 and index 7 as skipped within the
 * observed L0..L9 span. That is a real, spec-faithful observation, not a bug.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeTrace, parseNdjson } from "../src/normalize.js";
import type { NormalizedTrace } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const NDJSON = readFileSync(join(here, "fixtures", "backup-check.ndjson"), "utf8");

const EXPECTED: NormalizedTrace = {
  corr: "01AOCL_CORR_0001",
  stackId: "default",
  runId: "RUN-01AOCL-0001",
  layers: [
    {
      id: "L0.ingress.normalize",
      index: 0,
      eventId: "01AOCL_EVENT_L0_0001",
      intent: "aocl.layer.decision",
      timing_ms: 8,
      decisions: [{ code: "NORMALIZED", reason: "Parsed task + created run identifiers" }],
      control: { halt_pipeline: false },
    },
    {
      id: "L1.identity.scope",
      index: 1,
      eventId: "01AOCL_EVENT_L1_0001",
      intent: "aocl.layer.decision",
      timing_ms: 12,
      decisions: [
        { code: "SCOPED", reason: "Resolved identity + applied redaction + tool scope" },
      ],
      control: { halt_pipeline: false },
    },
    {
      id: "L2.route.smart",
      index: 2,
      eventId: "01AOCL_EVENT_L2_0001",
      intent: "aocl.layer.decision",
      timing_ms: 5,
      decisions: [
        { code: "NO_FASTPATH", reason: "No deterministic cached answer for this intent" },
      ],
      control: { halt_pipeline: false },
    },
    {
      id: "L3.policy.gate",
      index: 3,
      eventId: "01AOCL_EVENT_L3_0001",
      intent: "aocl.layer.decision",
      timing_ms: 9,
      decisions: [
        { code: "POLICY_ALLOW", reason: "Permitted read-only tools; evidence requested" },
      ],
      control: { halt_pipeline: false },
    },
    {
      id: "L5.context.retrieve",
      index: 5,
      eventId: "01AOCL_EVENT_L5_0001",
      intent: "aocl.layer.decision",
      timing_ms: 44,
      decisions: [
        { code: "CONTEXT_REFS", reason: "Attached inventory ref + last known backup job refs" },
      ],
      control: { halt_pipeline: false },
    },
    {
      id: "L6.shape.rewrite",
      index: 6,
      eventId: "01AOCL_EVENT_L6_0001",
      intent: "aocl.layer.decision",
      timing_ms: 18,
      decisions: [
        { code: "SHAPED", reason: "Prepared delegation payload with refs + constraints" },
      ],
      control: { halt_pipeline: false },
    },
    {
      id: "L8.verify.check",
      index: 8,
      eventId: "01AOCL_EVENT_L8_0001",
      intent: "aocl.verify.result",
      timing_ms: null,
      decisions: [],
      control: null,
    },
    {
      id: "L9.assemble.respond",
      index: 9,
      eventId: "01AOCL_EVENT_L9_0001",
      intent: "aocl.layer.decision",
      timing_ms: 22,
      decisions: [
        { code: "ASSEMBLED", reason: "Prepared human-readable response with evidence refs" },
      ],
      control: { halt_pipeline: false },
    },
  ],
  observedIndices: [0, 1, 2, 3, 5, 6, 8, 9],
  findings: [
    {
      code: "gap",
      severity: "warning",
      reason: "layer_skipped",
      layer: "L4.plan.decompose",
      detail: "no layer event for index 4 within observed span L0..L9",
    },
    {
      code: "gap",
      severity: "warning",
      reason: "layer_skipped",
      layer: "L7.delegate.execute",
      detail: "no layer event for index 7 within observed span L0..L9",
    },
  ],
  valid: true,
};

describe("conformance: backup-check.ndjson normalized trace", () => {
  it("parses all 14 envelopes with no parse errors", () => {
    const { events, parseErrors } = parseNdjson(NDJSON);
    expect(events).toHaveLength(14);
    expect(parseErrors).toEqual([]);
  });

  it("normalizes to the hand-computed vector exactly", () => {
    const { events } = parseNdjson(NDJSON);
    const trace = normalizeTrace(events, "01AOCL_CORR_0001");
    expect(trace).toEqual(EXPECTED);
  });
});
