/**
 * @quox/aocl: framework-agnostic AOCL layer tracer, stack validator, and
 * trace normalizer.
 *
 * Portable: the layer model, tracer, stack validation, and trace normalization.
 * NOT portable (stays in your orchestrator/QuoxCORE): policy EVALUATION, which
 * decides verdicts. This package only records and normalizes; it never decides.
 */

export * from "./types.js";
export {
  CANONICAL_LAYERS,
  isCanonicalLayer,
  getLayer,
  getLayerByIndex,
  layerIndex,
} from "./layers.js";
export { loadStack, validateStack } from "./stack.js";
export {
  AOCL_INTENTS,
  isAoclIntent,
  isLayerIntent,
  layerIdForEvent,
  toEnvelope,
  fromEnvelope,
  toNormalizedLayer,
} from "./aee.js";
export type { ToEnvelopeInput, ExtractedLayerEvent } from "./aee.js";
export { LayerTracer, TracerRegistry } from "./tracer.js";
export type { TracerOptions, LayerDecisionInput } from "./tracer.js";
export {
  parseNdjson,
  groupByCorr,
  normalizeTrace,
  normalizeAll,
} from "./normalize.js";
export type { NormalizeOptions } from "./normalize.js";
export { SCHEMA_FILES, schemaPath, loadSchema } from "./schema.js";
export type { SchemaName } from "./schema.js";
