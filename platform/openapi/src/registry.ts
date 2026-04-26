/**
 * `OpenAPIRegistry` — builder for the canonical OpenAPI 3.1 document.
 *
 * Mirrors the surface of `@asteasolutions/zod-to-openapi`'s registry
 * (`registerComponent`, `register`, `registerPath`) so a future swap to
 * that library is mechanical.
 *
 * Conventions:
 *   - `register(name, schema, opts?)` declares a NAMED component schema.
 *     Anywhere that schema is referenced thereafter, the spec emits a
 *     `$ref` instead of inlining.
 *   - `registerPath(...)` records one operation. Tags + security come
 *     from this call, not from the path itself.
 *   - `buildDocument(info, servers, securitySchemes)` does the final
 *     resolution into a fully-populated OpenAPI 3.1 document.
 *
 * The registry MUTATES the components store as schemas are registered,
 * but it never mutates the input Zod schema. The output is pure data.
 */

import { z } from 'zod';
import { type OpenApiSchema, convert, makeContext } from './zod-to-openapi.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

export interface ParameterSpec {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required?: boolean;
  readonly description?: string;
  readonly schema: z.ZodTypeAny | OpenApiSchema;
  readonly example?: unknown;
}

export interface ResponseSpec {
  readonly description: string;
  readonly content?: Record<
    string,
    { readonly schema: z.ZodTypeAny | OpenApiSchema; readonly example?: unknown }
  >;
  readonly headers?: Record<
    string,
    { readonly description?: string; readonly schema: OpenApiSchema }
  >;
}

export interface RequestBodySpec {
  readonly description?: string;
  readonly required?: boolean;
  readonly content: Record<
    string,
    { readonly schema: z.ZodTypeAny | OpenApiSchema; readonly example?: unknown }
  >;
}

export interface PathSpec {
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary?: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly operationId?: string;
  readonly parameters?: readonly ParameterSpec[];
  readonly request?: RequestBodySpec;
  readonly responses: Record<string, ResponseSpec>;
  /** Empty array means "explicitly no auth"; undefined means inherit. */
  readonly security?: ReadonlyArray<Record<string, readonly string[]>>;
  readonly extensions?: Record<`x-${string}`, unknown>;
}

export interface RegisteredSchema {
  readonly name: string;
  readonly schema: z.ZodTypeAny;
  readonly description?: string;
}

/**
 * Stores everything needed to build a final OpenAPI 3.1 document.
 *
 * Ordering matters for cosmetics (operations appear in spec order) but
 * not for correctness. Schemas can be registered AFTER paths reference
 * them — the resolver runs when `buildDocument` is called, not eagerly.
 */
export class OpenAPIRegistry {
  private readonly schemas = new Map<string, RegisteredSchema>();
  private readonly paths: PathSpec[] = [];
  /** Reverse index: schema reference -> registered name. */
  private readonly nameByRef = new Map<z.ZodTypeAny, string>();
  private readonly tagDescriptions = new Map<string, string>();

  /** Register a Zod schema as a named OpenAPI component. */
  register(name: string, schema: z.ZodTypeAny, opts: { description?: string } = {}): z.ZodTypeAny {
    if (this.schemas.has(name)) {
      // Idempotent: re-registration with the same instance is a no-op,
      // re-registration with a DIFFERENT instance is a programming error.
      const existing = this.schemas.get(name);
      if (existing !== undefined && existing.schema !== schema) {
        throw new Error(`Duplicate schema name in OpenAPI registry: ${name}`);
      }
      return schema;
    }
    const entry: RegisteredSchema = {
      name,
      schema,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
    };
    this.schemas.set(name, entry);
    this.nameByRef.set(schema, name);
    return schema;
  }

  /** Whether a name has been registered. */
  has(name: string): boolean {
    return this.schemas.has(name);
  }

  /** All registered schemas — used by tests and the spec dumper. */
  listSchemas(): ReadonlyMap<string, RegisteredSchema> {
    return this.schemas;
  }

  /** Register a tag with a description (rendered in the spec's tags list). */
  registerTag(name: string, description: string): void {
    this.tagDescriptions.set(name, description);
  }

  /** Add an operation to the spec. */
  registerPath(spec: PathSpec): void {
    if (spec.description.trim().length === 0) {
      throw new Error(`OpenAPI: empty description on ${spec.method.toUpperCase()} ${spec.path}`);
    }
    if (spec.tags.length === 0) {
      throw new Error(`OpenAPI: missing tag on ${spec.method.toUpperCase()} ${spec.path}`);
    }
    this.paths.push(spec);
  }

  /** All registered paths (read-only). */
  listPaths(): readonly PathSpec[] {
    return this.paths;
  }

  /** Materialise the components object — used by buildDocument and tests. */
  buildComponentSchemas(): Record<string, OpenApiSchema> {
    const components: Record<string, OpenApiSchema> = {};
    const ctx = makeContext(components, this.nameByRef);
    for (const [name, entry] of this.schemas) {
      // Mark this schema as "currently being inlined" so the recursive
      // walker emits a $ref for any back-edge to it (e.g. the lazy
      // self-ref in `RunTreeNode`) instead of expanding indefinitely.
      ctx.expandingSelf = entry.schema;
      const sch = convert(entry.schema, ctx);
      ctx.expandingSelf = undefined;
      if (entry.description !== undefined && sch.description === undefined) {
        sch.description = entry.description;
      }
      components[name] = sch;
    }
    return components;
  }

  /** Sorted list of (tag, description) pairs for the spec's `tags` array. */
  buildTags(): { name: string; description: string }[] {
    const seen = new Set<string>();
    for (const p of this.paths) {
      for (const t of p.tags) seen.add(t);
    }
    return [...seen]
      .sort()
      .map((name) => ({ name, description: this.tagDescriptions.get(name) ?? '' }));
  }

  /** Resolve a parameter's schema (Zod or raw OpenAPI) into raw OpenAPI. */
  resolveSchema(
    s: z.ZodTypeAny | OpenApiSchema,
    components: Record<string, OpenApiSchema>,
  ): OpenApiSchema {
    if (s instanceof z.ZodType) {
      const ctx = makeContext(components, this.nameByRef);
      return convert(s, ctx);
    }
    return s;
  }
}
