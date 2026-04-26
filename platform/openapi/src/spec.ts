/**
 * Build the canonical OpenAPI 3.1 document for the ALDO AI control-plane API.
 *
 * The output is a fully-resolved, cacheable OpenAPI 3.1 doc with:
 *   - `info.*` populated from the apps/api package.json (caller passes
 *     in the version string),
 *   - `servers` for prod + local dev,
 *   - `components.securitySchemes` for BearerAuth + ApiKeyAuth,
 *   - `tags` derived from the operations,
 *   - `components.schemas` for every Zod schema from
 *     `@aldo-ai/api-contract` (under its registered name),
 *   - `paths` for every operation registered in `./operations/*.ts`,
 *   - `x-aldo-llm-agnostic: true` to make the platform position
 *     unmissable for integrators (CLAUDE.md non-negotiable #1).
 *
 * The builder is a pure function of the contract package + the version
 * string, so it can be cached safely.
 */

import { registerAdminOperations } from './operations/admin.js';
import { registerAgentOperations } from './operations/agents.js';
import { registerAlertOperations } from './operations/alerts.js';
import { registerAnnotationOperations } from './operations/annotations.js';
import { registerAuthOperations } from './operations/auth.js';
import { registerBillingOperations } from './operations/billing.js';
import { registerDashboardOperations } from './operations/dashboards.js';
import { registerEvalOperations } from './operations/eval.js';
import { registerHealthOperations } from './operations/health.js';
import { registerIntegrationOperations } from './operations/integrations.js';
import { registerModelOperations } from './operations/models.js';
import { registerNotificationOperations } from './operations/notifications.js';
import { registerObservabilityOperations } from './operations/observability.js';
import { registerPlaygroundOperations } from './operations/playground.js';
import { registerRunOperations } from './operations/runs.js';
import { registerSecretOperations } from './operations/secrets.js';
import { registerShareOperations } from './operations/shares.js';
import { registerViewOperations } from './operations/views.js';
import { OpenAPIRegistry } from './registry.js';
import { registerContractSchemas } from './schemas.js';

export interface BuildSpecOptions {
  /** Semantic version string from `apps/api/package.json`. */
  readonly version: string;
  /** Production server URL. Defaults to fly.dev. */
  readonly productionUrl?: string;
  /** Local-dev server URL. Defaults to localhost:8080. */
  readonly localUrl?: string;
  /** GitHub repo URL the license link should point at. */
  readonly githubUrl?: string;
}

/** Final document type — open enough to be JSON-serialisable. */
export type OpenApiDocument = {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
    license: { name: string; url: string };
    contact?: { name: string; url: string };
  };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
  security: { [name: string]: string[] }[];
  'x-aldo-llm-agnostic': true;
};

const DEFAULT_GITHUB = 'https://github.com/zeljan-alduk/ai';

/** Construct the spec. Pure function of inputs. */
export function buildOpenApiSpec(opts: BuildSpecOptions): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  // 1. Register every Zod schema first so operation references resolve
  //    via $ref instead of inlining.
  registerContractSchemas(registry);

  // 2. Register every operation. The order here is the order they
  //    appear in the spec's path map (rendering tools sort by tag,
  //    so this is purely cosmetic).
  registerHealthOperations(registry);
  registerAuthOperations(registry);
  registerAgentOperations(registry);
  registerRunOperations(registry);
  registerPlaygroundOperations(registry);
  registerModelOperations(registry);
  registerEvalOperations(registry);
  registerSecretOperations(registry);
  registerBillingOperations(registry);
  registerDashboardOperations(registry);
  registerAlertOperations(registry);
  registerAnnotationOperations(registry);
  registerShareOperations(registry);
  registerNotificationOperations(registry);
  registerIntegrationOperations(registry);
  registerObservabilityOperations(registry);
  registerViewOperations(registry);
  registerAdminOperations(registry);

  // 3. Resolve everything.
  const components = registry.buildComponentSchemas();
  const tags = registry.buildTags();

  // 4. Operations -> paths object.
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of registry.listPaths()) {
    if (paths[op.path] === undefined) paths[op.path] = {};
    const slot = paths[op.path] as Record<string, unknown>;
    const operation: Record<string, unknown> = {
      summary: op.summary,
      description: op.description,
      tags: [...op.tags],
      ...(op.operationId !== undefined ? { operationId: op.operationId } : {}),
      ...(op.parameters !== undefined && op.parameters.length > 0
        ? {
            parameters: op.parameters.map((p) => {
              const schema = registry.resolveSchema(p.schema, components);
              const out: Record<string, unknown> = {
                name: p.name,
                in: p.in,
                ...(p.required === true ? { required: true } : { required: p.in === 'path' }),
                ...(p.description !== undefined ? { description: p.description } : {}),
                schema,
              };
              if (p.example !== undefined) out.example = p.example;
              return out;
            }),
          }
        : {}),
      ...(op.request !== undefined
        ? {
            requestBody: {
              required: op.request.required ?? true,
              ...(op.request.description !== undefined
                ? { description: op.request.description }
                : {}),
              content: Object.fromEntries(
                Object.entries(op.request.content).map(([mt, body]) => {
                  const sch = registry.resolveSchema(body.schema, components);
                  const out: Record<string, unknown> = { schema: sch };
                  if (body.example !== undefined) out.example = body.example;
                  return [mt, out];
                }),
              ),
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(op.responses).map(([code, resp]) => {
          const out: Record<string, unknown> = { description: resp.description };
          if (resp.content !== undefined) {
            out.content = Object.fromEntries(
              Object.entries(resp.content).map(([mt, body]) => {
                const sch = registry.resolveSchema(body.schema, components);
                const inner: Record<string, unknown> = { schema: sch };
                if (body.example !== undefined) inner.example = body.example;
                return [mt, inner];
              }),
            );
          }
          if (resp.headers !== undefined) out.headers = resp.headers;
          return [code, out];
        }),
      ),
      ...(op.security !== undefined ? { security: op.security.map((s) => ({ ...s })) } : {}),
      ...(op.extensions !== undefined ? op.extensions : {}),
    };
    slot[op.method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'ALDO AI Control Plane API',
      version: opts.version,
      description: [
        'REST surface for the ALDO AI control plane. LLM-agnostic by design — agents declare capability classes, the model gateway picks a provider.',
        '',
        'Privacy tiers (`public` / `internal` / `sensitive`) are enforced platform-side: a `sensitive` agent cannot reach a cloud model. The router fails closed before any provider contact (`422 privacy_tier_unroutable`).',
        '',
        'Authentication: bearer token (HS256 JWT) for users, or `aldo_live_…` API key for service principals. Every non-public route requires one of the two; the WHO/WHAT lives in `components.securitySchemes`.',
      ].join('\n'),
      license: {
        name: 'FSL-1.1-ALv2',
        url: `${opts.githubUrl ?? DEFAULT_GITHUB}/blob/main/LICENSE`,
      },
      contact: { name: 'ALDO AI', url: opts.githubUrl ?? DEFAULT_GITHUB },
    },
    servers: [
      {
        url: opts.productionUrl ?? 'https://aldo-ai-api.fly.dev',
        description: 'Production',
      },
      {
        url: opts.localUrl ?? 'http://localhost:8080',
        description: 'Local dev',
      },
    ],
    tags,
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'HS256-signed session JWT. Issued by `POST /v1/auth/login` or `/v1/auth/signup`.',
        },
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Programmatic API key prefixed `aldo_live_`. Carries scopes (e.g. `runs:write`, `agents:read`, `admin:*`).',
        },
      },
    },
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    'x-aldo-llm-agnostic': true,
  };
}
