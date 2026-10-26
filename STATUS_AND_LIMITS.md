# STATUS_AND_LIMITS — AOCL SDK

> Treat the README and CHANGELOG as marketing-adjacent. Treat this file as the source of truth for what works and what doesn't in this package.

**Repo:** `aocl-sdk` (`@quox/aocl` TypeScript). MIT licensed, unpublished. Version `0.1.0`, tracks AOCL spec v0.1 (Experimental).
**Created:** 2026-07-25. **Last verified:** 2026-07-25 (tests run live against this checkout).
**Authoritative paths:** `src/layers.ts`, `src/tracer.ts`, `src/normalize.ts`, `src/stack.ts`, `src/aee.ts`, `bin/aocl-trace.ts`, `schemas/` (proposed-for-upstream JSON Schemas).

## How to read the tags

| Tag | Meaning |
|---|---|
| **Stable-candidate** | Fully implemented, spec-conformant, backed by an automated test suite with a live green run. Not "Stable" in the strict production-use sense yet (pre-launch, zero deployed consumers), but no known gap between spec and implementation. |
| **Not built** | Does not exist. |

## Maturity table

| Capability | Status | Notes |
|---|---|---|
| L0-L10 layer taxonomy | Stable-candidate | Canonical AOCL layer ids/names/descriptions/ordering as data, from `aocl/docs/stacks.md` §1. `test/layers.test.ts` (5 tests). |
| `LayerTracer` | Stable-candidate | Corr-scoped, records layer activity as spec-conformant AEE envelopes (NDJSON-emittable). Corr-keyed state only, no ambient global instance; `TracerRegistry` is provided for concurrent multi-corr processes so async contexts don't clobber each other. `test/tracer.test.ts` (4 tests). |
| Stack loading + validation (`loadStack`, `validateStack`) | Stable-candidate | Validates the aocl spec's own example stacks. Non-canonical layer ids are warnings, not errors, per spec (custom layers are permitted). `test/stack.test.ts` (8 tests). |
| Trace normalizer (`parseNdjson`, `normalizeTrace`) | Stable-candidate | Orders events, flags gap / out-of-order / unknown / duplicate / stack-relative missing findings. Malformed events become findings, they never crash the normalizer. `parseNdjson` tolerates a truncated final line with a distinct `truncated_final_line` warning (vs. `invalid_json` for a malformed line elsewhere). Ports the pure-normalizer semantics of `quox-qluster/server/lib/aocl.js` `buildLayerTrace`. `test/normalize.test.ts` (9 tests) plus `test/adversarial.test.ts` (32 tests) targeting malformed/hostile input. |
| Collector emission shape compatibility | Stable-candidate | The normalizer's layer-resolution code (`src/aee.ts`) explicitly accepts two shapes: `payload.layer.id` (canonical AOCL object shape per `aee-binding.md` §6) and `payload.layer` as a plain string (the shape the QuoxCORE collector's `services/collector/lib/aoclPipeline.js` actually emits, e.g. `payload.layer: "L1"`). Verified directly in `src/aee.ts` comments and logic, not just asserted in this doc. |
| AEE binding (`toEnvelope`, `fromEnvelope`, `layerIdForEvent`) | Stable-candidate | Plain-object helpers, shape-compatible with AEE v1 envelopes, no dependency on any AEE SDK so this package and `@quox/aee-sdk` can version independently. `test/aee.test.ts` (5 tests). |
| `aocl-trace` CLI | Stable-candidate | Exit codes: 0 valid (warnings allowed), 1 validation errors, 2 usage/IO error. `test/cli.test.ts` (6 tests). |
| Conformance against spec examples | Stable-candidate | `test/conformance.test.ts` (2 tests) plus `test/schema.test.ts` (7 tests) validating spec example files against the vendored schemas. |
| Whole suite | Stable-candidate | 78 tests across 9 files, all green as of this verification pass (`npx vitest run`). |

## Schemas: proposed for upstream, not spec-canonical

The `aocl` spec repo has no `schemas/` directory at v0.1; its own roadmap lists JSON Schemas + validators as a v0.2 item. This package ships `schemas/aocl-stack.schema.json` and `schemas/aocl-trace-event.schema.json`, authored strictly from the spec prose and examples, each carrying a `$comment` marking it proposed-for-upstream. These are this SDK's best-effort candidate schemas, not schemas the spec itself has ratified. Core ships no JSON Schema validator (zero deps); bring your own (e.g. `ajv`) or use the zero-dependency structural checks in `validateStack`/`normalizeTrace`.

## Boundary: policy evaluation is NOT in this SDK

This is a deliberate, documented scope line, verified against the README's own "What is portable, and what is not" table:

- **Portable (shipped here):** the L0-L10 layer taxonomy as data, the corr-scoped `LayerTracer`, stack definition loading + structural validation, the trace normalizer (gaps/out-of-order/unknown detection), the proposed JSON Schemas.
- **Not portable (stays in the orchestrator):** policy *evaluation* (deciding allow/deny/require-approval), identity resolution, compliance/safety engines, HITL wiring, the stores the layers read (VOLT, org policy, secrets), and the runtime that actually delegates work to agents/tools.

The tracer records; it never decides. In QuoxCORE, the deciding half (the `aoclPipeline` evaluator) is server-side and stays there. Do not present this SDK as doing policy enforcement.

## Not built

- **Python port.** This package is JavaScript/TypeScript only.

## Known gaps

- The AOCL spec itself is marked "v0.1, Experimental" upstream. This SDK tracks that experimental spec faithfully, but a downstream consumer should treat the *spec's* current maturity, not just this SDK's test coverage, as part of the risk picture.
- Schemas are this SDK's interpretation of prose, not a ratified spec artifact; if the upstream v0.2 schemas diverge from these, that is expected, not a bug here.

## What this SDK is NOT

- Not a policy engine. It does not decide allow/deny/require-approval; see the boundary section above.
- Not connected to a runtime that delegates work; it only records and validates what already happened.
- Not the schema source of truth; the schemas here are proposed-for-upstream candidates, not the spec's own artifacts (which do not yet exist at v0.1).

## Cross-cutting (applies to all four SDK repos: aee-sdk, ward-sdk, volt-sdk, aocl-sdk)

- None of the four packages are published to npm or PyPI yet. Publishing is owner-gated, planned for launch.
- None of the four repos have a public GitHub remote configured yet (`git remote -v` returns empty in all four checkouts as of this verification). Publishing the remote is owner-gated.
- Install-from-source only today. Any `npm install @quox/aocl` (or `npm install github:quoxai/aocl-sdk`) instruction elsewhere is aspirational until launch and the remote exists.
- Zero runtime dependencies in core.
