/**
 * AOCL <-> AEE binding helpers.
 *
 * Implements the mapping in aocl/docs/aee-binding.md WITHOUT importing an AEE
 * SDK: every helper emits or reads plain objects, so @quox/aocl keeps zero
 * runtime dependencies. The emitted objects are shape-compatible with AEE v1
 * envelopes and interoperate with @quox/aee-sdk (pass them straight to its
 * validate()/sign() functions). See the README "AEE interop" section.
 *
 * Binding rules honoured here:
 *  - AOCL meaning lives in `intent` (aocl.* namespace) + `payload`; the AEE
 *    envelope shape is unchanged (binding.md §2, §6).
 *  - All envelopes for one work item share the originating `corr` (§4.1).
 *  - Strategy A (root-linked) reply chaining: layer events reply_to the
 *    originating request (§4.2). Callers may override reply_to for Strategy B.
 */

import type { AeeEnvelope, ControlFlags, LayerDecision, NormalizedLayer } from "./types.js";
import { layerIndex } from "./layers.js";

/** The AOCL core intent namespace (aee-binding.md §3). */
export const AOCL_INTENTS = {
  stackSelect: "aocl.stack.select",
  layerEnter: "aocl.layer.enter",
  layerExit: "aocl.layer.exit",
  layerDecision: "aocl.layer.decision",
  contextPatch: "aocl.context.patch",
  controlBranch: "aocl.control.branch",
  controlBypass: "aocl.control.bypass",
  verifyResult: "aocl.verify.result",
  runSummary: "aocl.run.summary",
} as const;

/** True if the intent is in the AOCL namespace. */
export function isAoclIntent(intent: string): boolean {
  return intent.startsWith("aocl.");
}

/** True if the intent is a per-layer AOCL intent that carries a layer id. */
export function isLayerIntent(intent: string): boolean {
  return intent.startsWith("aocl.layer.") || intent === AOCL_INTENTS.contextPatch;
}

/**
 * Canonical layer id for an event, per binding conventions. Resolves, in order:
 *
 *  1. payload.layer.id: the canonical AOCL object shape (aee-binding.md §6).
 *  2. payload.layer as a plain STRING: the QuoxCORE collector emission shape
 *     (services/collector/lib/aoclPipeline.js emits `payload.layer: "L1"`).
 *  3. an `aocl.layer.<id>.<verb>` intent (collector form, e.g.
 *     `aocl.layer.L1.complete`) when payload carries no layer.
 *  4. aocl.verify.result -> the fixed L8.verify.check layer.
 *
 * Returns null when no layer applies. Never throws on a missing/hostile payload.
 */
export function layerIdForEvent(envelope: AeeEnvelope): string | null {
  const payload =
    envelope && typeof envelope.payload === "object" && envelope.payload !== null
      ? (envelope.payload as Record<string, unknown>)
      : {};
  const layer = payload.layer;
  // Shape 1: layer as an object with a string id.
  if (layer && typeof layer === "object" && !Array.isArray(layer)) {
    const id = (layer as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  // Shape 2: layer as a plain string id (collector emission).
  if (typeof layer === "string" && layer.length > 0) return layer;
  // Shape 3: derive the layer id from an aocl.layer.<id>.<verb> intent.
  const intent = typeof envelope?.intent === "string" ? envelope.intent : "";
  const m = /^aocl\.layer\.(L\d+)\.[a-z]+$/i.exec(intent);
  if (m) return m[1]!;
  // Shape 4: fixed-layer intents.
  if (intent === AOCL_INTENTS.verifyResult) return "L8.verify.check";
  return null;
}

export interface ToEnvelopeInput {
  intent: string;
  corr: string;
  /** Originating request id; used as reply_to under Strategy A. */
  replyTo?: string | null;
  from?: string;
  to?: string;
  id: string;
  ts: string;
  type?: AeeEnvelope["type"];
  priority?: AeeEnvelope["priority"];
  payload: Record<string, unknown>;
}

/**
 * Build a plain AEE-shaped envelope for an AOCL event. Defaults: from
 * "agent.orchestrator", to "log.aocl", type "event", priority "normal"
 * (matching the aee-binding.md examples).
 */
export function toEnvelope(input: ToEnvelopeInput): AeeEnvelope {
  return {
    v: "1",
    id: input.id,
    ts: input.ts,
    type: input.type ?? "event",
    from: input.from ?? "agent.orchestrator",
    to: input.to ?? "log.aocl",
    intent: input.intent,
    corr: input.corr,
    reply_to: input.replyTo ?? null,
    trace: null,
    priority: input.priority ?? "normal",
    requires: null,
    payload: input.payload,
    sig: null,
  };
}

/** A layer event projected out of an AEE envelope. */
export interface ExtractedLayerEvent {
  corr: string;
  eventId: string;
  intent: string;
  layerId: string | null;
  layerIndex: number | null;
  runId: string | null;
  stackId: string | null;
  timing_ms: number | null;
  decisions: LayerDecision[];
  control: ControlFlags | null;
  ts: string;
}

/**
 * Read AOCL fields back out of an AEE envelope into a plain object (no AEE SDK
 * required). Non-layer envelopes still return corr/eventId with layerId null.
 */
export function fromEnvelope(envelope: AeeEnvelope): ExtractedLayerEvent {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const layerId = layerIdForEvent(envelope);
  const decisions = Array.isArray(payload.decisions)
    ? (payload.decisions as LayerDecision[])
    : [];
  const control =
    payload.control && typeof payload.control === "object"
      ? (payload.control as ControlFlags)
      : null;
  const timing = typeof payload.timing_ms === "number" ? payload.timing_ms : null;
  return {
    corr: envelope.corr,
    eventId: envelope.id,
    intent: envelope.intent,
    layerId,
    layerIndex: layerId ? layerIndex(layerId) : null,
    runId: typeof payload.run_id === "string" ? payload.run_id : null,
    stackId: typeof payload.stack_id === "string" ? payload.stack_id : null,
    timing_ms: timing,
    decisions,
    control,
    ts: envelope.ts,
  };
}

/**
 * Normalize a single layer event envelope into a NormalizedLayer record.
 * Returns null only when no layer id can be resolved at all. A resolvable id
 * with no numeric index (a custom taxonomy id) still yields a record with
 * index === null, so it is never silently dropped.
 */
export function toNormalizedLayer(envelope: AeeEnvelope): NormalizedLayer | null {
  const ext = fromEnvelope(envelope);
  if (ext.layerId == null) return null;
  return {
    id: ext.layerId,
    index: ext.layerIndex,
    eventId: ext.eventId,
    intent: ext.intent,
    timing_ms: ext.timing_ms,
    decisions: ext.decisions,
    control: ext.control,
  };
}
