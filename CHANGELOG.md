# Changelog

All notable changes to `@quox/aocl` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/), versioning is
[SemVer](https://semver.org/).

## [0.1.0] - 2026-07-25

Initial release. Not yet published to npm (planned for launch).

### Added

- **Layer model.** Canonical AOCL L0..L10 taxonomy as data (ids, names,
  descriptions, numeric ordering), from `aocl/docs/stacks.md` §1.
- **Stack validation.** `loadStack` + `validateStack` for pipeline and DAG
  stack definitions, zero runtime dependencies. Validates the aocl example
  stacks; non-canonical layer ids are warnings, not errors.
- **LayerTracer.** Framework-agnostic, corr-scoped tracer that records layer
  transitions and decisions as spec-conformant AEE envelopes (NDJSON-emittable).
  Corr-keyed state only, no ambient instance stacks; `TracerRegistry` for
  multi-corr processes.
- **Trace normalizer.** `parseNdjson` (tolerant of a truncated final line, with
  a distinct `truncated_final_line` reason) and `normalizeTrace` (ordered
  per-corr layer trace, flags gaps, out-of-order, unknown, duplicate, and
  stack-relative missing/unexpected layers). Ports the pure-normalizer semantics
  of `quox-qluster/server/lib/aocl.js` `buildLayerTrace`.
- **AEE binding.** Plain-object helpers (`toEnvelope`, `fromEnvelope`,
  `layerIdForEvent`, intent constants) per `aocl/docs/aee-binding.md`, with no
  dependency on any AEE SDK.
- **JSON Schemas (proposed for upstream).** `schemas/aocl-stack.schema.json` and
  `schemas/aocl-trace-event.schema.json`, authored from the spec prose and
  examples for the aocl v0.2 roadmap. Every aocl example file is validated
  against them in the test suite.
- **CLI.** `aocl-trace <trace.ndjson> [--stack <stack.json>]`, exit codes
  0 / 1 / 2.
- **Conformance vector.** The normalized output for
  `aocl/examples/traces/backup-check.ndjson` is asserted as a hand-computed
  literal.
