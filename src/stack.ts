/**
 * Stack definition loading + validation.
 *
 * Structural validation is hand-rolled (zero runtime deps) and mirrors the
 * vendored JSON Schema in schemas/aocl-stack.schema.json. Both must agree on
 * the example stacks; the test suite cross-checks them.
 *
 * Source: aocl/docs/stacks.md (pipeline + DAG formats) and docs/examples.md
 * (realtime-alert, restricted-textonly).
 */

import type { Finding, StackDef, ValidateResult } from "./types.js";
import { isCanonicalLayer } from "./layers.js";

const NODE_ID_RE = /^(L\d+\.[a-z]+\.[a-z]+|BR\.[a-z_]+)$/;

/** Parse a stack definition from a JSON string (throws on malformed JSON). */
export function loadStack(json: string): StackDef {
  const parsed = JSON.parse(json) as unknown;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("aocl.loadStack: stack definition must be a JSON object");
  }
  return parsed as StackDef;
}

function err(code: string, reason: string, extra: Partial<Finding> = {}): Finding {
  return { code, severity: "error", reason, ...extra };
}

function warn(code: string, reason: string, extra: Partial<Finding> = {}): Finding {
  return { code, severity: "warning", reason, ...extra };
}

/**
 * Validate a stack definition against the AOCL v0.1 structure. Returns all
 * findings; `valid` is false when any error-severity finding is present.
 * Unknown (non-canonical) layer ids are warnings, not errors: the spec permits
 * custom taxonomies while RECOMMENDING the canonical set.
 */
export function validateStack(stack: unknown): ValidateResult {
  const findings: Finding[] = [];

  if (stack == null || typeof stack !== "object" || Array.isArray(stack)) {
    return { valid: false, findings: [err("not_object", "stack must be an object")] };
  }
  const s = stack as Record<string, unknown>;

  if (typeof s.stack_id !== "string" || s.stack_id.length === 0) {
    findings.push(err("missing_stack_id", "stack_id is required and must be a non-empty string"));
  }
  if (typeof s.version !== "string" || s.version.length === 0) {
    findings.push(err("missing_version", "version is required and must be a non-empty string"));
  }
  if (s.mode !== "pipeline" && s.mode !== "dag") {
    findings.push(err("bad_mode", 'mode must be "pipeline" or "dag"'));
  }

  if (s.mode === "pipeline") {
    validatePipeline(s, findings);
  } else if (s.mode === "dag") {
    validateDag(s, findings);
  }

  const valid = findings.every((f) => f.severity !== "error");
  return { valid, findings };
}

function validatePipeline(s: Record<string, unknown>, findings: Finding[]): void {
  const layers = s.layers;
  if (!Array.isArray(layers) || layers.length === 0) {
    findings.push(err("missing_layers", "pipeline stacks require a non-empty layers array"));
    return;
  }
  layers.forEach((layer, i) => {
    if (layer == null || typeof layer !== "object" || Array.isArray(layer)) {
      findings.push(err("bad_layer", `layers[${i}] must be an object`));
      return;
    }
    const l = layer as Record<string, unknown>;
    if (typeof l.id !== "string" || l.id.length === 0) {
      findings.push(err("missing_layer_id", `layers[${i}].id is required`));
      return;
    }
    if (l.ref !== undefined && typeof l.ref !== "string") {
      findings.push(err("bad_layer_ref", `layers[${i}].ref must be a string when present`, { layer: l.id }));
    }
    if (l.enabled !== undefined && typeof l.enabled !== "boolean") {
      findings.push(err("bad_layer_enabled", `layers[${i}].enabled must be a boolean when present`, { layer: l.id }));
    }
    if (!isCanonicalLayer(l.id)) {
      findings.push(warn("unknown_layer", `layers[${i}].id "${l.id}" is not a canonical AOCL layer`, { layer: l.id }));
    }
  });
}

function validateDag(s: Record<string, unknown>, findings: Finding[]): void {
  const nodes = s.nodes;
  const edges = s.edges;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    findings.push(err("missing_nodes", "dag stacks require a non-empty nodes array"));
  }
  if (!Array.isArray(edges)) {
    findings.push(err("missing_edges", "dag stacks require an edges array"));
  }

  const nodeIds = new Set<string>();
  if (Array.isArray(nodes)) {
    nodes.forEach((node, i) => {
      if (node == null || typeof node !== "object" || Array.isArray(node)) {
        findings.push(err("bad_node", `nodes[${i}] must be an object`));
        return;
      }
      const n = node as Record<string, unknown>;
      if (typeof n.id !== "string" || !NODE_ID_RE.test(n.id)) {
        findings.push(err("bad_node_id", `nodes[${i}].id must match a canonical layer or BR.* id`));
        return;
      }
      nodeIds.add(n.id);
      if (!NODE_ID_RE.test(n.id)) return;
      if (n.id.startsWith("L") && !isCanonicalLayer(n.id)) {
        findings.push(warn("unknown_layer", `nodes[${i}].id "${n.id}" is not a canonical AOCL layer`, { layer: n.id }));
      }
    });
  }

  if (Array.isArray(edges)) {
    edges.forEach((edge, i) => {
      if (edge == null || typeof edge !== "object" || Array.isArray(edge)) {
        findings.push(err("bad_edge", `edges[${i}] must be an object`));
        return;
      }
      const e = edge as Record<string, unknown>;
      if (typeof e.from !== "string" || typeof e.to !== "string") {
        findings.push(err("bad_edge_ends", `edges[${i}] requires string from/to`));
        return;
      }
      if (nodeIds.size > 0 && !nodeIds.has(e.from)) {
        findings.push(warn("dangling_edge_from", `edges[${i}].from "${e.from}" is not a declared node`));
      }
      if (nodeIds.size > 0 && !nodeIds.has(e.to)) {
        findings.push(warn("dangling_edge_to", `edges[${i}].to "${e.to}" is not a declared node`));
      }
      if (e.when !== undefined && typeof e.when !== "string") {
        findings.push(err("bad_edge_when", `edges[${i}].when must be a string when present`));
      }
    });
  }
}
