/**
 * Trace normalizer + NDJSON parser.
 *
 * Ports the semantics of quox-qluster/server/lib/aocl.js `buildLayerTrace`
 * (a pure normalizer: shape raw layer results into an ordered per-layer trace,
 * omit absent layers, never emit null placeholders) and extends it with the
 * gap / out-of-order / unknown-layer detection the SDK task requires.
 *
 * IMPORTANT: this is a normalizer, not the QuoxCORE policy evaluator. It does
 * not decide verdicts. It orders observed layer activity and flags structural
 * problems in the trace.
 */

import type {
  AeeEnvelope,
  Finding,
  LayerDecision,
  NormalizedLayer,
  NormalizedTrace,
  ParseResult,
  StackDef,
} from "./types.js";
import { getLayerByIndex, isCanonicalLayer } from "./layers.js";
import { AOCL_INTENTS, fromEnvelope, isLayerIntent, toNormalizedLayer } from "./aee.js";

/** True for a non-null, non-array plain object. */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

/**
 * Parse NDJSON into AEE envelopes, tolerant of a truncated final line.
 *
 * A non-final line that fails to parse is reported with reason "invalid_json".
 * A failing FINAL line (a common artefact of a log tail cut mid-write) is
 * reported with the DISTINCT reason "truncated_final_line" and does not throw.
 * Blank lines (including a trailing newline) are skipped silently.
 */
export function parseNdjson(text: string): ParseResult {
  const events: AeeEnvelope[] = [];
  const parseErrors: Finding[] = [];
  const rawLines = text.split("\n");
  // Determine the index of the last non-empty line so we can special-case it.
  let lastNonEmpty = -1;
  for (let i = rawLines.length - 1; i >= 0; i -= 1) {
    if (rawLines[i]!.trim().length > 0) {
      lastNonEmpty = i;
      break;
    }
  }

  rawLines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      events.push(JSON.parse(trimmed) as AeeEnvelope);
    } catch {
      if (i === lastNonEmpty) {
        parseErrors.push({
          code: "truncated_final_line",
          severity: "warning",
          reason: "truncated_final_line",
          detail: `line ${i + 1} did not parse as JSON and is the final line; treating as a truncated tail`,
        });
      } else {
        parseErrors.push({
          code: "invalid_json",
          severity: "error",
          reason: "invalid_json",
          detail: `line ${i + 1} is not valid JSON`,
        });
      }
    }
  });

  return { events, parseErrors };
}

export interface NormalizeOptions {
  /** If provided, gaps/unexpected layers are computed against this stack. */
  stack?: StackDef;
  /**
   * Lenient mode: a layer-intended event that yields no resolvable layer id
   * becomes a WARNING (trace stays valid) instead of an error. Default strict.
   */
  lenient?: boolean;
}

/** All layer/node ids DECLARED in a stack definition (custom ids included). */
function stackDeclaredIds(stack: StackDef): Set<string> {
  const ids = new Set<string>();
  if (Array.isArray(stack.layers)) for (const l of stack.layers) if (l && typeof l.id === "string") ids.add(l.id);
  if (Array.isArray(stack.nodes)) for (const n of stack.nodes) if (n && typeof n.id === "string") ids.add(n.id);
  return ids;
}

/**
 * A layer id is "known" if it is a canonical AOCL id, a bare canonical index
 * form the collector emits ("L3" -> L3.policy.gate), or declared in the active
 * stack (spec-permitted custom taxonomy). Everything else is unknown_layer.
 */
function isKnownLayerId(id: string, index: number | null, stackDeclared: Set<string>): boolean {
  if (isCanonicalLayer(id)) return true;
  if (index != null && getLayerByIndex(index) && id === `L${index}`) return true;
  if (stackDeclared.has(id)) return true;
  return false;
}

/** Stable join of decision codes, for conflict comparison between duplicates. */
function decisionCodes(decisions: LayerDecision[]): string {
  return decisions.map((d) => d.code).join("|");
}

/** Group already-parsed envelopes by corr, preserving file order per corr. */
export function groupByCorr(events: AeeEnvelope[]): Map<string, AeeEnvelope[]> {
  const byCorr = new Map<string, AeeEnvelope[]>();
  for (const ev of events) {
    if (!ev || typeof ev.corr !== "string") continue;
    const list = byCorr.get(ev.corr) ?? [];
    list.push(ev);
    byCorr.set(ev.corr, list);
  }
  return byCorr;
}

function enabledStackLayerIds(stack: StackDef): string[] {
  if (stack.mode === "pipeline" && Array.isArray(stack.layers)) {
    return stack.layers.filter((l) => l.enabled !== false).map((l) => l.id);
  }
  if (stack.mode === "dag" && Array.isArray(stack.nodes)) {
    return stack.nodes.map((n) => n.id).filter((id) => /^L\d+\./.test(id));
  }
  return [];
}

/**
 * Normalize the envelopes for a SINGLE corr into an ordered layer trace with
 * findings. Envelopes for other corrs are ignored if present.
 */
export function normalizeTrace(
  events: AeeEnvelope[],
  corr: string,
  opts: NormalizeOptions = {},
): NormalizedTrace {
  const findings: Finding[] = [];
  const layers: NormalizedLayer[] = [];
  const byId = new Map<string, NormalizedLayer>();
  const stackDeclared = opts.stack ? stackDeclaredIds(opts.stack) : new Set<string>();
  let stackId: string | null = opts.stack?.stack_id ?? null;
  let runId: string | null = null;
  // Chronology cursor: ts of the previously KEPT layer, in file order.
  let lastKeptTs: string | null = null;

  events.forEach((ev, i) => {
    // MAJOR-1: a null / non-object line is a malformed event, never a throw.
    if (!isPlainObject(ev)) {
      findings.push({
        code: "malformed_event",
        severity: "error",
        reason: "malformed_event",
        detail: `event at index ${i} is not an object`,
      });
      return;
    }
    if (ev.corr !== corr) return;

    // MAJOR-1: a missing / non-object payload is malformed, never a throw.
    if (!isPlainObject(ev.payload)) {
      findings.push({
        code: "malformed_event",
        severity: "error",
        reason: "malformed_event",
        detail: `event at index ${i} (${String(ev.id)}) has a missing or non-object payload`,
      });
      return;
    }

    const ext = fromEnvelope(ev);
    if (ext.stackId && !stackId) stackId = ext.stackId;
    if (ext.runId && !runId) runId = ext.runId;
    if (ev.intent === AOCL_INTENTS.stackSelect && ext.stackId) stackId = ext.stackId;

    const layerId = ext.layerId;
    if (layerId == null) {
      // MAJOR-2: a layer-intended event with no resolvable layer must not be
      // dropped silently; it is an error (warning under lenient mode).
      if (isLayerIntent(ev.intent)) {
        findings.push({
          code: "unresolved_layer_event",
          severity: opts.lenient ? "warning" : "error",
          reason: "unresolved_layer_event",
          detail: `event at index ${i} has layer intent "${ev.intent}" but no resolvable layer id`,
        });
      }
      return; // non-layer envelope (stack.select, run.summary, delegation, ...)
    }

    const norm = toNormalizedLayer(ev);
    if (!norm) return;

    // MAJOR-2: unknown ids (not canonical, not bare-canonical, not stack-declared)
    // are a WARNING, not an error and not a silent drop. Spec permits custom
    // taxonomies (stacks.md §1), so a stack-declared id is custom-and-fine. An
    // unknown id is reported but NOT placed in the ordered pipeline, so its
    // (possibly wild) index cannot corrupt gap / out-of-order detection.
    if (!isKnownLayerId(norm.id, norm.index, stackDeclared)) {
      findings.push({
        code: "unknown_layer",
        severity: "warning",
        reason: "unknown_layer",
        layer: norm.id,
        detail: `"${norm.id}" is not in the canonical L0..L10 taxonomy or the active stack`,
      });
      return;
    }

    // Duplicate layer event: keep the first (buildLayerTrace one-per-key).
    const prev = byId.get(norm.id);
    if (prev) {
      // MINOR (c): a duplicate carrying DIFFERENT decisions than the kept event
      // (e.g. a DENY masked by a later OK) is a hard conflict, not a benign dupe.
      if (decisionCodes(prev.decisions) !== decisionCodes(norm.decisions)) {
        findings.push({
          code: "conflicting_layer_decision",
          severity: "error",
          reason: "conflicting_layer_decision",
          layer: norm.id,
          detail: `layer ${norm.id} appears again with conflicting decisions (kept [${decisionCodes(prev.decisions) || "-"}] vs dropped [${decisionCodes(norm.decisions) || "-"}])`,
        });
      } else {
        findings.push({
          code: "duplicate_layer",
          severity: "warning",
          reason: "duplicate_layer",
          layer: norm.id,
          detail: `layer ${norm.id} appears more than once; keeping first occurrence`,
        });
      }
      return;
    }

    // MINOR (d): chronology. In file order, a kept layer whose timestamp is
    // strictly earlier than the previous kept layer's is out of chronology.
    const ts = typeof ev.ts === "string" ? ev.ts : null;
    if (ts && lastKeptTs && ts < lastKeptTs) {
      findings.push({
        code: "out_of_chronology",
        severity: "warning",
        reason: "out_of_chronology",
        layer: norm.id,
        detail: `${norm.id} ts ${ts} is earlier than the preceding layer ts ${lastKeptTs}`,
      });
    }
    if (ts) lastKeptTs = ts;

    byId.set(norm.id, norm);
    layers.push(norm);
  });

  // Out-of-order: observed INDICES must be strictly increasing in file order.
  // Custom ids with no numeric index take no position and are skipped here.
  const indexed = layers.filter(
    (l): l is NormalizedLayer & { index: number } => l.index != null,
  );
  for (let i = 1; i < indexed.length; i += 1) {
    if (indexed[i]!.index <= indexed[i - 1]!.index) {
      findings.push({
        code: "out_of_order",
        severity: "error",
        reason: "out_of_order",
        layer: indexed[i]!.id,
        detail: `${indexed[i]!.id} (index ${indexed[i]!.index}) appears after ${indexed[i - 1]!.id} (index ${indexed[i - 1]!.index})`,
      });
    }
  }

  const observedIndices = indexed.map((l) => l.index);

  if (opts.stack) {
    // Stack-aware gap detection: enabled-but-missing and unexpected layers.
    const expected = enabledStackLayerIds(opts.stack);
    const observedIds = new Set(layers.map((l) => l.id));
    for (const id of expected) {
      if (!observedIds.has(id)) {
        findings.push({
          code: "missing_layer",
          severity: "warning",
          reason: "layer_skipped",
          layer: id,
          detail: `${id} is enabled in stack "${opts.stack.stack_id}" but no layer event was observed`,
        });
      }
    }
    const expectedSet = new Set(expected);
    for (const l of layers) {
      if (!expectedSet.has(l.id)) {
        findings.push({
          code: "unexpected_layer",
          severity: "warning",
          reason: "layer_not_in_stack",
          layer: l.id,
          detail: `${l.id} was observed but is not enabled in stack "${opts.stack.stack_id}"`,
        });
      }
    }
  } else if (observedIndices.length > 0) {
    // Span-based gap detection: canonical layers strictly inside the observed
    // [min,max] span that were not observed are flagged as skipped (warning).
    const min = Math.min(...observedIndices);
    const max = Math.max(...observedIndices);
    const present = new Set(observedIndices);
    for (let idx = min + 1; idx < max; idx += 1) {
      if (!present.has(idx)) {
        const id = getLayerByIndex(idx)?.id ?? `L${idx}`;
        findings.push({
          code: "gap",
          severity: "warning",
          reason: "layer_skipped",
          layer: id,
          detail: `no layer event for index ${idx} within observed span L${min}..L${max}`,
        });
      }
    }
  }

  const valid = findings.every((f) => f.severity !== "error");
  return { corr, stackId, runId, layers, observedIndices, findings, valid };
}

/**
 * Normalize every corr present in a set of envelopes.
 *
 * MINOR (e): one grouping pass indexes events by corr, then each corr is
 * normalized against only its own (small) event list. This is O(events), not
 * O(corrs x events). Malformed events (null / non-object / missing string corr)
 * cannot be attached to any corr, so they surface in a leading synthetic
 * "(malformed)" trace (valid:false) that callers/CLI report and fail on.
 */
export function normalizeAll(
  events: AeeEnvelope[],
  opts: NormalizeOptions = {},
): NormalizedTrace[] {
  const byCorr = new Map<string, AeeEnvelope[]>();
  const malformed: Finding[] = [];
  events.forEach((ev, i) => {
    if (!isPlainObject(ev) || typeof ev.corr !== "string") {
      malformed.push({
        code: "malformed_event",
        severity: "error",
        reason: "malformed_event",
        detail: `event at index ${i} is malformed (not an object, or missing a string corr)`,
      });
      return;
    }
    const list = byCorr.get(ev.corr) ?? [];
    list.push(ev);
    byCorr.set(ev.corr, list);
  });

  const traces = [...byCorr.entries()].map(([corr, evs]) => normalizeTrace(evs, corr, opts));
  if (malformed.length > 0) {
    traces.unshift({
      corr: "(malformed)",
      stackId: null,
      runId: null,
      layers: [],
      observedIndices: [],
      findings: malformed,
      valid: false,
    });
  }
  return traces;
}
