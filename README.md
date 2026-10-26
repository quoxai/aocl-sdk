# @quox/aocl

Framework-agnostic **AOCL** (Agent Orchestration Control Layers) layer tracer,
stack validator, and trace normalizer for TypeScript / Node.

AOCL standardizes how an orchestrator processes an event by passing it through
ordered **layers** (normalize, identity, policy, route, plan, retrieve, shape,
delegate, verify, respond, audit) and emitting that layer activity as auditable
**AEE** envelopes. This package packages the AOCL layer *model* and the
*observability* side of the spec so any app can record and validate layer
traces, regardless of framework.

- Spec: https://github.com/quoxai/aocl (v0.1, Experimental)
- Companion protocol (AEE): https://github.com/quoxai/aee

> **Status:** v0.1.0. Publishing to npm at launch. It is not on the registry
> yet, so do not copy a `npm install @quox/aocl` line into anything real until
> the launch note here says it is live. Install from source in the meantime
> (see below).

## What is portable, and what is not

This is the honest boundary, and it is deliberate:

| Portable (shipped here) | Not portable (stays in your orchestrator) |
| --- | --- |
| The canonical L0..L10 layer taxonomy as data | Policy **evaluation** (deciding allow / deny / require-approval) |
| A corr-scoped `LayerTracer` that records layer activity as AEE envelopes | Identity resolution, compliance/safety engines, HITL wiring |
| Stack definition loading + structural validation | The stores those layers read (VOLT, org policy, secrets) |
| A trace normalizer that orders events and flags gaps / out-of-order / unknown layers | The runtime that actually delegates work to agents/tools |
| Proposed JSON Schemas for stack files and trace events | |

The tracer **records**; it never **decides**. In QuoxCORE the deciding half
(the `aoclPipeline` evaluator) is server-side and stays there. This SDK is the
part of AOCL that is safe and useful to run anywhere: the layer model plus the
audit trail.

## Install (from source)

npm registry publish is planned for launch, and the repo
(github.com/quoxai/aocl-sdk) opens at launch as well. Until then, build from a
checkout:

```bash
cd aocl-sdk
npm install
npm run build
```

Then reference the built package by path (`npm install /path/to/aocl-sdk`),
via `npm link`, or import from source in a monorepo.

## Usage

### Record a layer trace

```ts
import { LayerTracer } from "@quox/aocl";

const tracer = new LayerTracer({
  corr: "01AOCL_CORR_0001",
  runId: "RUN-01AOCL-0001",
  originId: "01ORIGIN_TASK_0001", // reply_to (Strategy A, root-linked)
});

tracer.stackSelect("default", "standard ops check");
tracer.layerDecision("L3.policy.gate", {
  timing_ms: 9,
  decisions: [{ code: "POLICY_ALLOW", reason: "Permitted read-only tools" }],
  control: { halt_pipeline: false },
});
tracer.verifyResult({ status: "pass", confidence: 0.96 });

const ndjson = tracer.toNdjson(); // one AEE envelope per line
```

A `LayerTracer` is scoped to exactly one `corr` and keeps its state on the
instance. There is no ambient "current tracer": for concurrent work items use a
`TracerRegistry` (a corr-keyed map) rather than a global, so async contexts do
not clobber each other.

### Validate a stack

```ts
import { loadStack, validateStack } from "@quox/aocl";

const stack = loadStack(fs.readFileSync("stacks/realtime-alert.json", "utf8"));
const { valid, findings } = validateStack(stack);
```

Non-canonical layer ids are **warnings**, not errors: the spec RECOMMENDS the
L0..L10 taxonomy but permits custom layers.

### Normalize + validate a trace

```ts
import { parseNdjson, normalizeTrace } from "@quox/aocl";

const { events, parseErrors } = parseNdjson(ndjsonText);
const trace = normalizeTrace(events, "01AOCL_CORR_0001", { stack });

trace.layers;   // ordered per-layer records
trace.findings; // gap / out_of_order / unknown_layer / missing_layer / ...
trace.valid;    // false if any error-severity finding
```

`parseNdjson` tolerates a **truncated final line** (a common log-tail artefact):
it reports it with the distinct reason `truncated_final_line` (a warning) and
does not throw. A malformed line elsewhere is an `invalid_json` error.

### CLI

```
aocl-trace <trace.ndjson> [--stack <stack.json>]
```

Exit codes: `0` valid (warnings allowed), `1` validation errors, `2` usage / IO
error.

## AEE interop

The binding in `src/aee.ts` follows `aocl/docs/aee-binding.md` and emits **plain
objects** so this package keeps zero runtime dependencies. Those objects are
shape-compatible with AEE v1 envelopes: you can pass them straight into
`@quox/aee-sdk` for validation or signing, and read AOCL fields back out with
`fromEnvelope()`. This SDK does not import an AEE SDK, so the two can version
independently.

The normalizer accepts **both** layer shapes seen in the wild: the canonical
object form (`payload.layer.id`, per `aee-binding.md`) and the plain-string
form the QuoxCORE collector actually emits today (`payload.layer: "L1"`), so
real collector traces normalize without a translation step.

## Schemas (proposed for upstream)

The aocl spec repo has no `schemas/` directory at v0.1; its roadmap promises
JSON Schemas + validators at v0.2. This package vendors candidate schemas under
`schemas/`, authored strictly from the spec prose and examples:

- `schemas/aocl-stack.schema.json`
- `schemas/aocl-trace-event.schema.json`

Each carries a `$comment` marking it proposed-for-upstream. The test suite
validates every example file from the aocl repo against them. Core ships **no
JSON Schema validator** (zero deps); bring your own (for example `ajv`) or use
the zero-dep structural checks in `validateStack` / `normalizeTrace`.

## Status and maturity

**[STATUS_AND_LIMITS.md](./STATUS_AND_LIMITS.md) is the honest source of truth
for what works and what doesn't.** Where this README and that file disagree,
that file wins. Snapshot as of the last verification pass: 78 tests across 9
files, all green, run live against this checkout. Not built: a Python port
(this package is TypeScript/Node only). Also remember the spec itself is
v0.1 Experimental upstream; treat that as part of the risk picture.

## License

Apache-2.0. See [LICENSE](./LICENSE).
