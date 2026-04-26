/**
 * @aldo-ai/openapi
 *
 * Canonical OpenAPI 3.1 spec for the ALDO AI control-plane API. The
 * spec is built from `@aldo-ai/api-contract`'s Zod schemas; this package
 * is the SINGLE source of truth for `/openapi.json` + `/api/docs`
 * (Swagger UI) + `/api/redoc` (Redoc).
 *
 * Public surface:
 *   - `OpenAPIRegistry`        — the builder primitive (mostly
 *     internal; used by `./operations/*`).
 *   - `buildOpenApiSpec(opts)` — pure function returning the doc.
 *   - `dumpYaml(doc)`          — JSON-or-YAML serialiser (for
 *     `GET /openapi.yaml`).
 *   - `validateOpenApi(doc)`   — fast structural validator
 *     (used by `aldo openapi validate <file>` + the test suite).
 */

export { OpenAPIRegistry } from './registry.js';
export type {
  HttpMethod,
  ParameterSpec,
  PathSpec,
  RequestBodySpec,
  ResponseSpec,
} from './registry.js';
export type { OpenApiSchema } from './zod-to-openapi.js';
export { registerContractSchemas, expectedSchemaNames } from './schemas.js';
export { buildOpenApiSpec } from './spec.js';
export type { BuildSpecOptions, OpenApiDocument } from './spec.js';
export { dumpYaml } from './yaml.js';
export { validateOpenApi } from './validate.js';
export type { ValidationIssue, ValidationResult } from './validate.js';
