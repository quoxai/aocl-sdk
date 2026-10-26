/**
 * Canonical AOCL layer taxonomy as data.
 *
 * Source of truth: aocl/docs/stacks.md §1 "Recommended Layer Taxonomy".
 * The spec defines eleven canonical layers L0..L10. Names/descriptions are
 * copied verbatim from the spec prose. Ordering is the numeric index parsed
 * from the id, so L10 correctly sorts after L9 (not lexically).
 */

import type { LayerDef } from "./types.js";

/** The canonical L0..L10 taxonomy, in spec order. */
export const CANONICAL_LAYERS: readonly LayerDef[] = [
  {
    id: "L0.ingress.normalize",
    index: 0,
    name: "ingress.normalize",
    description:
      "Normalize incoming events (chat/webhook/email/alert), create run IDs, basic parsing.",
  },
  {
    id: "L1.identity.scope",
    index: 1,
    name: "identity.scope",
    description: "Apply identity, permissions, secret scope, and redaction rules.",
  },
  {
    id: "L2.route.smart",
    index: 2,
    name: "route.smart",
    description: "Deterministic fast-path router (pattern match, cached answers, known commands).",
  },
  {
    id: "L3.policy.gate",
    index: 3,
    name: "policy.gate",
    description: "Safety/compliance checks, tool/model restrictions, HITL requirements.",
  },
  {
    id: "L4.plan.decompose",
    index: 4,
    name: "plan.decompose",
    description: "Convert intent into structured objectives, decide if multi-step/multi-agent.",
  },
  {
    id: "L5.context.retrieve",
    index: 5,
    name: "context.retrieve",
    description: "Retrieve memory/files/RAG context; produce refs + bounded summaries.",
  },
  {
    id: "L6.shape.rewrite",
    index: 6,
    name: "shape.rewrite",
    description: "Rewrite/structure into operational form (e.g., AEE tasks, tool plans, schemas).",
  },
  {
    id: "L7.delegate.execute",
    index: 7,
    name: "delegate.execute",
    description: "Delegate to agents/tools, manage dependencies/concurrency (runtime-specific).",
  },
  {
    id: "L8.verify.check",
    index: 8,
    name: "verify.check",
    description: "Verification/evals/consistency checks; evidence requirements.",
  },
  {
    id: "L9.assemble.respond",
    index: 9,
    name: "assemble.respond",
    description: "Assemble final response; redact; apply tone/formatting constraints.",
  },
  {
    id: "L10.audit.writeback",
    index: 10,
    name: "audit.writeback",
    description: "Persist trace summaries and permitted memory writeback.",
  },
];

const BY_ID = new Map(CANONICAL_LAYERS.map((l) => [l.id, l]));
const BY_INDEX = new Map(CANONICAL_LAYERS.map((l) => [l.index, l]));

/** True if the given id is a canonical AOCL layer id. */
export function isCanonicalLayer(id: string): boolean {
  return BY_ID.has(id);
}

/** Look up a canonical layer by its full id (e.g. "L3.policy.gate"). */
export function getLayer(id: string): LayerDef | undefined {
  return BY_ID.get(id);
}

/** Look up a canonical layer by numeric index (0..10). */
export function getLayerByIndex(index: number): LayerDef | undefined {
  return BY_INDEX.get(index);
}

/**
 * Parse the numeric index out of a layer id. Accepts both the full canonical
 * form ("L7.delegate.execute" -> 7) AND the bare index form the QuoxCORE
 * collector emits ("L3" -> 3). Returns null for ids that do not begin with an
 * L-number segment (e.g. custom taxonomy ids, or "L-1.evil.layer").
 */
export function layerIndex(id: string): number | null {
  const match = /^L(\d+)(?:\.|$)/.exec(id);
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}
