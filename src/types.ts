/**
 * Shared types for @quox/aocl.
 *
 * Derived strictly from the AOCL v0.1 spec prose and examples in the aocl repo
 * (docs/spec.md, docs/stacks.md, docs/aee-binding.md, docs/observability.md,
 * docs/examples.md). No runtime dependencies.
 */

/** A single canonical AOCL control layer. */
export interface LayerDef {
  /** Canonical id, e.g. "L3.policy.gate". */
  id: string;
  /** Numeric ordering index parsed from the id (L0 = 0, L10 = 10). */
  index: number;
  /** Human-readable name, e.g. "policy.gate". */
  name: string;
  /** One-line description from the spec taxonomy. */
  description: string;
}

/** A layer entry inside a pipeline stack definition. */
export interface StackLayerEntry {
  id: string;
  ref?: string;
  enabled?: boolean;
}

/** A node inside a DAG stack definition. */
export interface StackNode {
  id: string;
  ref?: string;
}

/** An edge inside a DAG stack definition. */
export interface StackEdge {
  from: string;
  to: string;
  when?: string;
}

/** A stack definition (pipeline or DAG) per docs/stacks.md. */
export interface StackDef {
  stack_id: string;
  version: string;
  mode: "pipeline" | "dag";
  layers?: StackLayerEntry[];
  nodes?: StackNode[];
  edges?: StackEdge[];
  defaults?: Record<string, unknown>;
  bypass_policy?: Record<string, unknown>;
  policy_overrides?: Record<string, unknown>;
}

/** A validation finding (structural or normalization). */
export interface Finding {
  code: string;
  severity: "error" | "warning";
  reason: string;
  /** Layer id the finding relates to, when applicable. */
  layer?: string;
  /** Free-form detail. */
  detail?: string;
}

/** Result of validating a stack definition. */
export interface ValidateResult {
  valid: boolean;
  findings: Finding[];
}

/** Minimal AEE envelope shape used by AOCL trace events (a subset of AEE v1). */
export interface AeeEnvelope {
  v: string;
  id: string;
  ts: string;
  type: "task" | "result" | "event" | "error" | "stream";
  from: string;
  to: string;
  intent: string;
  corr: string;
  reply_to?: string | null;
  trace?: { trace_id?: string; span_id?: string } | null;
  priority?: "low" | "normal" | "high" | "urgent";
  requires?: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  sig?: unknown;
}

/** A layer decision entry, as carried in an aocl.layer.* payload. */
export interface LayerDecision {
  code: string;
  reason: string;
}

/** Control flags carried in an aocl.layer.* payload. */
export interface ControlFlags {
  halt_pipeline?: boolean;
  branch_to?: string | null;
  bypass_layers?: string[];
  require_hitl?: boolean;
  severity?: string;
  [key: string]: unknown;
}

/** A single normalized layer record within a per-corr trace. */
export interface NormalizedLayer {
  id: string;
  /**
   * Numeric ordering index parsed from the id (L0 = 0 ... L10 = 10). Null when
   * the id carries no L-number prefix (a custom/non-canonical taxonomy id): such
   * layers are still recorded, but take no position in the ordered pipeline.
   */
  index: number | null;
  eventId: string;
  intent: string;
  timing_ms: number | null;
  decisions: LayerDecision[];
  control: ControlFlags | null;
}

/** A normalized per-corr layer trace. */
export interface NormalizedTrace {
  corr: string;
  stackId: string | null;
  runId: string | null;
  layers: NormalizedLayer[];
  observedIndices: number[];
  findings: Finding[];
  valid: boolean;
}

/** Result of parsing NDJSON, tolerant of a truncated final line. */
export interface ParseResult {
  events: AeeEnvelope[];
  parseErrors: Finding[];
}
