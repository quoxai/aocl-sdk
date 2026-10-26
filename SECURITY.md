# Security Policy

## Scope

`@quox/aocl` is a pure, offline library: it records and normalizes AOCL layer
traces. It performs no network I/O, spawns no processes, and (in core) has zero
runtime dependencies. It does **not** evaluate policy, resolve identity, or
handle secrets; that half of AOCL stays in your orchestrator.

## Redaction is the caller's responsibility

Per `aocl/docs/observability.md` §7, layer traces MUST NOT carry raw secrets or
full file contents. This library records whatever payload you hand it, so:

- Apply your redaction policy **before** calling `tracer.layerDecision(...)`.
- Prefer refs + digests + small summaries over inlined content, as the spec
  RECOMMENDS.
- Treat emitted NDJSON as potentially sensitive and store it under the same
  access controls as your other audit logs.

## Trust boundaries when consuming traces

`parseNdjson` and `normalizeTrace` accept untrusted input. They are defensive:
malformed JSON is reported, never thrown past the parser, and a truncated final
line is tolerated. They do not `eval`, do not follow refs, and do not fetch
anything. Findings are advisory; enforce them in your own pipeline.

## Reporting a vulnerability

Report suspected vulnerabilities privately to security@quox.ai rather than
opening a public issue. Please include a reproduction and the affected
version. Triage is best-effort and carries no service-level agreement.
