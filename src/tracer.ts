/**
 * Framework-agnostic LayerTracer.
 *
 * A tracer instance is scoped to exactly ONE correlation id (`corr`). It holds
 * its recorded events in an instance-local array. There is deliberately NO
 * ambient/global "current tracer" stack: async-context safety comes from each
 * caller owning its own corr-scoped instance (or looking one up by corr via
 * TracerRegistry). This avoids the cross-request state bleed that ambient
 * singletons cause under concurrency.
 *
 * The tracer only RECORDS layer activity as spec-conformant AEE envelopes
 * (aocl.* intents, NDJSON-emittable). It does not evaluate policy: policy
 * decisions are computed by the caller/orchestrator and passed in. Emitting a
 * decision here is an audit act, not a control act.
 */

import type { AeeEnvelope, ControlFlags, LayerDecision } from "./types.js";
import { AOCL_INTENTS, toEnvelope } from "./aee.js";

export interface TracerOptions {
  corr: string;
  runId?: string;
  stackId?: string;
  /** Originating request envelope id, used as reply_to (Strategy A). */
  originId?: string | null;
  from?: string;
  to?: string;
  /** Deterministic id factory (nth event -> id). Defaults to a corr-derived counter. */
  idFactory?: (seq: number, intent: string) => string;
  /** Clock for ts values. Defaults to () => new Date().toISOString(). */
  clock?: () => string;
}

export interface LayerDecisionInput {
  decisions?: LayerDecision[];
  delta?: Record<string, unknown>;
  refs?: string[];
  digests?: Record<string, string>;
  control?: ControlFlags;
  timing_ms?: number;
  /** Layer version string; defaults to "0.1". */
  version?: string;
}

export class LayerTracer {
  readonly corr: string;
  private runId?: string;
  private stackId?: string;
  private readonly originId: string | null;
  private readonly from: string;
  private readonly to: string;
  private readonly idFactory: (seq: number, intent: string) => string;
  private readonly clock: () => string;
  private readonly recorded: AeeEnvelope[] = [];
  private seq = 0;

  constructor(opts: TracerOptions) {
    if (!opts.corr || opts.corr.length < 1) {
      throw new Error("LayerTracer: a corr is required");
    }
    // MINOR (b): the vendored trace/AEE schemas require corr minLength 8. If a
    // caller supplies a shorter corr, generate a compliant one (deterministic
    // pad) and warn, so every self-emitted envelope validates.
    if (opts.corr.length < 8) {
      const padded = opts.corr.padEnd(8, "0");
      console.warn(
        `LayerTracer: corr "${opts.corr}" is shorter than the 8-char schema minimum; using "${padded}"`,
      );
      this.corr = padded;
    } else {
      this.corr = opts.corr;
    }
    this.runId = opts.runId;
    this.stackId = opts.stackId;
    this.originId = opts.originId ?? null;
    this.from = opts.from ?? "agent.orchestrator";
    this.to = opts.to ?? "log.aocl";
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.idFactory =
      opts.idFactory ?? ((seq) => `${this.corr}_EV_${String(seq).padStart(4, "0")}`);
  }

  private nextId(intent: string): string {
    this.seq += 1;
    return this.idFactory(this.seq, intent);
  }

  private base(intent: string, payload: Record<string, unknown>): AeeEnvelope {
    const env = toEnvelope({
      id: this.nextId(intent),
      ts: this.clock(),
      intent,
      corr: this.corr,
      replyTo: this.originId,
      from: this.from,
      to: this.to,
      payload,
    });
    this.recorded.push(env);
    return env;
  }

  /** Record stack selection (aocl.stack.select). Sets runId/stackId defaults. */
  stackSelect(stackId: string, reason?: string, runId?: string): AeeEnvelope {
    if (runId) this.runId = runId;
    this.stackId = stackId;
    return this.base(AOCL_INTENTS.stackSelect, {
      ...(this.runId ? { run_id: this.runId } : {}),
      stack_id: stackId,
      ...(reason ? { reason } : {}),
    });
  }

  /** Record a layer decision (aocl.layer.decision) for a canonical layer id. */
  layerDecision(layerId: string, input: LayerDecisionInput = {}): AeeEnvelope {
    const payload: Record<string, unknown> = {
      ...(this.runId ? { run_id: this.runId } : {}),
      ...(this.stackId ? { stack_id: this.stackId } : {}),
      layer: { id: layerId, version: input.version ?? "0.1" },
    };
    if (typeof input.timing_ms === "number") payload.timing_ms = input.timing_ms;
    payload.decisions = input.decisions ?? [];
    if (input.delta) payload.delta = input.delta;
    payload.refs = input.refs ?? [];
    if (input.digests) payload.digests = input.digests;
    payload.control = input.control ?? { halt_pipeline: false };
    return this.base(AOCL_INTENTS.layerDecision, payload);
  }

  /** Record a verification result (aocl.verify.result -> L8.verify.check). */
  verifyResult(verification: Record<string, unknown>): AeeEnvelope {
    return this.base(AOCL_INTENTS.verifyResult, {
      ...(this.runId ? { run_id: this.runId } : {}),
      verification,
    });
  }

  /** Record an explicit bypass event (aocl.control.bypass). */
  bypass(info: {
    requested_by?: string;
    layers: string[];
    allowed: boolean;
    reason: string;
  }): AeeEnvelope {
    return this.base(AOCL_INTENTS.controlBypass, {
      ...(this.runId ? { run_id: this.runId } : {}),
      ...info,
    });
  }

  /** Record a branch event (aocl.control.branch). */
  branch(info: { from: string; to: string; reason: string }): AeeEnvelope {
    return this.base(AOCL_INTENTS.controlBranch, {
      ...(this.runId ? { run_id: this.runId } : {}),
      ...info,
    });
  }

  /** Record an end-of-run summary (aocl.run.summary). */
  runSummary(summary: Record<string, unknown>): AeeEnvelope {
    return this.base(AOCL_INTENTS.runSummary, {
      ...(this.runId ? { run_id: this.runId } : {}),
      ...(this.stackId ? { stack_id: this.stackId } : {}),
      ...summary,
    });
  }

  /** All recorded envelopes, in emission order. */
  events(): AeeEnvelope[] {
    return this.recorded.slice();
  }

  /** Serialize all recorded envelopes as NDJSON (one envelope per line). */
  toNdjson(): string {
    return this.recorded.map((e) => JSON.stringify(e)).join("\n");
  }
}

/**
 * A corr-keyed registry of tracers. Use this when one process interleaves many
 * work items: look the tracer up by corr instead of threading it through every
 * call, and WITHOUT a mutable "current" pointer that concurrent tasks would
 * clobber.
 */
export class TracerRegistry {
  private readonly byCorr = new Map<string, LayerTracer>();

  get(corr: string): LayerTracer | undefined {
    return this.byCorr.get(corr);
  }

  getOrCreate(opts: TracerOptions): LayerTracer {
    const existing = this.byCorr.get(opts.corr);
    if (existing) return existing;
    const tracer = new LayerTracer(opts);
    this.byCorr.set(opts.corr, tracer);
    return tracer;
  }

  delete(corr: string): boolean {
    return this.byCorr.delete(corr);
  }

  size(): number {
    return this.byCorr.size;
  }
}
