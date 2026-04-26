/**
 * Minimal but correct Zod -> OpenAPI 3.1 schema converter.
 *
 * Why we ship our own instead of pulling
 * `@asteasolutions/zod-to-openapi`:
 *
 *   - We control the surface area exactly. The wire-format Zod schemas
 *     in @aldo-ai/api-contract use a small, fixed subset of Zod (objects,
 *     enums, primitives, arrays, nullable, optional, union,
 *     discriminatedUnion, lazy/recursive, intersection, record, literal,
 *     `coerce.*`, `unknown`/`any`). Hand-rolling the converter against
 *     this subset is ~200 lines and keeps the API spec a deterministic
 *     pure function of the contract.
 *   - Zero new external runtime dependencies on the platform package.
 *   - Recursive schemas (`z.lazy`) need an explicit name registration
 *     anyway; that's the same shape `@asteasolutions/zod-to-openapi`
 *     uses (`registry.register(name, schema)`), so swapping libraries
 *     later is mechanical.
 *
 * The output targets OpenAPI 3.1 (which is a strict superset of JSON
 * Schema 2020-12), so:
 *   - `nullable: true` is NOT used; we emit `type: ['string', 'null']`.
 *   - `examples` is an array, not a singleton.
 *   - `$ref` siblings (e.g. `description`) are allowed.
 */

import type { z } from 'zod';

/** The minimal OpenAPI 3.1 schema subtree we emit. Open enough to be merged. */
export type OpenApiSchema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  title?: string;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchema;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  nullable?: boolean;
  /** Vendor extension; preserved through the registry. */
  [k: `x-${string}`]: unknown;
};

interface ConvertContext {
  /** Schemas we've already resolved to a top-level component name. */
  readonly nameByRef: Map<z.ZodTypeAny, string>;
  /** Component-store accumulator (mutated by recursive calls). */
  readonly components: Record<string, OpenApiSchema>;
  /** Schemas that are mid-conversion — break recursion. */
  readonly inFlight: Set<z.ZodTypeAny>;
  /**
   * The schema currently being INLINED at the top level. When the
   * walker encounters it again (a back-edge in a recursive type) it
   * emits a `$ref` to its registered name instead of recursing — this
   * is how self-recursive types like `RunTreeNode` terminate.
   */
  expandingSelf?: z.ZodTypeAny | undefined;
}

const REF_PREFIX = '#/components/schemas/';

function refTo(name: string): OpenApiSchema {
  return { $ref: `${REF_PREFIX}${name}` };
}

/**
 * Pull the inner Zod node out of any wrapper (Effects, Default, Branded,
 * Catch, Pipeline, ReadOnly). We treat these as transparent — they don't
 * change the wire shape from the client's perspective.
 */
function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  let cur = s;
  // eslint-disable-next-line no-constant-condition
  for (let i = 0; i < 16; i++) {
    const def = (
      cur as unknown as {
        _def?: {
          typeName?: string;
          schema?: z.ZodTypeAny;
          innerType?: z.ZodTypeAny;
          in?: z.ZodTypeAny;
        };
      }
    )._def;
    if (def === undefined) return cur;
    const tn = def.typeName;
    if (tn === 'ZodEffects' && def.schema !== undefined) {
      cur = def.schema;
    } else if (tn === 'ZodDefault' && def.innerType !== undefined) {
      cur = def.innerType;
    } else if (tn === 'ZodBranded' && def.innerType !== undefined) {
      cur = def.innerType;
    } else if (tn === 'ZodCatch' && def.innerType !== undefined) {
      cur = def.innerType;
    } else if (tn === 'ZodReadonly' && def.innerType !== undefined) {
      cur = def.innerType;
    } else if (tn === 'ZodPipeline' && def.in !== undefined) {
      // Pipelines carry an in/out pair; the wire shape is the input.
      cur = def.in;
    } else {
      return cur;
    }
  }
  return cur;
}

function describe(s: z.ZodTypeAny): string | undefined {
  const d = (s as unknown as { _def?: { description?: string } })._def?.description;
  return typeof d === 'string' && d.length > 0 ? d : undefined;
}

interface CheckLite {
  readonly kind: string;
  readonly value?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly inclusive?: boolean;
  readonly regex?: { source: string };
}

function checks(s: z.ZodTypeAny): readonly CheckLite[] {
  const arr = (s as unknown as { _def?: { checks?: readonly CheckLite[] } })._def?.checks;
  return Array.isArray(arr) ? arr : [];
}

function applyStringChecks(node: z.ZodTypeAny, out: OpenApiSchema): void {
  for (const c of checks(node)) {
    if (c.kind === 'min' && typeof c.value === 'number') out.minLength = c.value;
    else if (c.kind === 'max' && typeof c.value === 'number') out.maxLength = c.value;
    else if (c.kind === 'length' && typeof c.value === 'number') {
      out.minLength = c.value;
      out.maxLength = c.value;
    } else if (c.kind === 'email') out.format = 'email';
    else if (c.kind === 'url') out.format = 'uri';
    else if (c.kind === 'uuid') out.format = 'uuid';
    else if (c.kind === 'datetime') out.format = 'date-time';
    else if (c.kind === 'date') out.format = 'date';
    else if (c.kind === 'regex' && c.regex !== undefined) out.pattern = c.regex.source;
  }
}

function applyNumberChecks(node: z.ZodTypeAny, out: OpenApiSchema): void {
  for (const c of checks(node)) {
    if (c.kind === 'int') out.type = 'integer';
    else if (c.kind === 'min' && typeof c.value === 'number') {
      out.minimum = c.value;
    } else if (c.kind === 'max' && typeof c.value === 'number') {
      out.maximum = c.value;
    } else if (c.kind === 'multipleOf' && typeof c.value === 'number') {
      // OpenAPI uses `multipleOf` directly.
      (out as Record<string, unknown>).multipleOf = c.value;
    }
  }
}

function applyArrayChecks(node: z.ZodTypeAny, out: OpenApiSchema): void {
  for (const c of checks(node)) {
    if (c.kind === 'min' && typeof c.value === 'number') out.minItems = c.value;
    else if (c.kind === 'max' && typeof c.value === 'number') out.maxItems = c.value;
    else if (c.kind === 'length' && typeof c.value === 'number') {
      out.minItems = c.value;
      out.maxItems = c.value;
    }
  }
}

function nullable(inner: OpenApiSchema): OpenApiSchema {
  // OpenAPI 3.1 way: union with `null`. If the inner has a `$ref`, we can't
  // mutate type — wrap in `oneOf`.
  if (inner.$ref !== undefined) {
    return { oneOf: [inner, { type: 'null' }] };
  }
  if (Array.isArray(inner.type)) {
    if (!inner.type.includes('null')) inner.type = [...inner.type, 'null'];
    return inner;
  }
  if (typeof inner.type === 'string') {
    inner.type = [inner.type, 'null'];
    return inner;
  }
  // No primitive type set; allow null at the boundary.
  return { ...inner, oneOf: [...(inner.oneOf ?? []), { type: 'null' }] };
}

function fromLiteral(value: unknown): OpenApiSchema {
  if (value === null) return { type: 'null' };
  switch (typeof value) {
    case 'string':
      return { type: 'string', const: value };
    case 'number':
      return { type: 'number', const: value };
    case 'boolean':
      return { type: 'boolean', const: value };
    default:
      return { const: value };
  }
}

function emitObject(node: z.ZodTypeAny, ctx: ConvertContext): OpenApiSchema {
  const def = (
    node as unknown as {
      _def: {
        shape: () => Record<string, z.ZodTypeAny>;
        catchall?: z.ZodTypeAny;
        unknownKeys?: 'strict' | 'strip' | 'passthrough';
      };
    }
  )._def;
  const shape =
    typeof def.shape === 'function'
      ? def.shape()
      : (def as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
  const properties: Record<string, OpenApiSchema> = {};
  const required: string[] = [];
  for (const [key, child] of Object.entries(shape)) {
    const inner = unwrap(child);
    const tn = (inner as unknown as { _def?: { typeName?: string } })._def?.typeName;
    const isOptional = tn === 'ZodOptional';
    let valueNode: z.ZodTypeAny = inner;
    if (isOptional) {
      const innerOpt = (inner as unknown as { _def?: { innerType?: z.ZodTypeAny } })._def
        ?.innerType;
      if (innerOpt !== undefined) valueNode = innerOpt;
    }
    const sch = convert(valueNode, ctx);
    const desc = describe(child) ?? describe(inner) ?? describe(valueNode);
    if (desc !== undefined && sch.$ref === undefined) sch.description = desc;
    properties[key] = sch;
    if (!isOptional) required.push(key);
  }
  const out: OpenApiSchema = {
    type: 'object',
    properties,
  };
  if (required.length > 0) out.required = required;
  if (def.catchall !== undefined) {
    const cn = (def.catchall as unknown as { _def?: { typeName?: string } })._def?.typeName;
    if (cn === 'ZodNever') {
      out.additionalProperties = false;
    } else {
      out.additionalProperties = convert(def.catchall, ctx);
    }
  } else if (def.unknownKeys === 'strict') {
    out.additionalProperties = false;
  }
  return out;
}

/**
 * Convert a Zod schema to an OpenAPI 3.1 schema fragment. Resolves
 * registered names to `$ref` automatically; everything else is inlined.
 */
export function convert(schema: z.ZodTypeAny, ctx: ConvertContext): OpenApiSchema {
  const node = unwrap(schema);
  // Already-registered top-level type → emit a $ref. Skip the ref
  // emission for the schema we're currently inlining (the top-level
  // call into buildComponentSchemas marks it via `expandingSelf`).
  const known = ctx.nameByRef.get(node) ?? ctx.nameByRef.get(schema);
  if (known !== undefined) {
    const isTopLevelExpansion =
      ctx.expandingSelf !== undefined &&
      (ctx.expandingSelf === node || ctx.expandingSelf === schema);
    if (!isTopLevelExpansion) {
      // Either we've already crossed the lazy boundary (inFlight), or
      // this is a back-edge from another component. Either way: ref.
      return refTo(known);
    }
  }

  const tn = (node as unknown as { _def?: { typeName?: string } })._def?.typeName;
  const desc = describe(schema) ?? describe(node);

  let out: OpenApiSchema;
  switch (tn) {
    case 'ZodString': {
      out = { type: 'string' };
      applyStringChecks(node, out);
      break;
    }
    case 'ZodNumber': {
      out = { type: 'number' };
      applyNumberChecks(node, out);
      break;
    }
    case 'ZodBigInt': {
      out = { type: 'integer', format: 'int64' };
      break;
    }
    case 'ZodBoolean': {
      out = { type: 'boolean' };
      break;
    }
    case 'ZodDate': {
      out = { type: 'string', format: 'date-time' };
      break;
    }
    case 'ZodNull': {
      out = { type: 'null' };
      break;
    }
    case 'ZodUndefined':
    case 'ZodVoid': {
      // Nothing on the wire — represent as `{}` (any).
      out = {};
      break;
    }
    case 'ZodAny':
    case 'ZodUnknown': {
      out = {};
      break;
    }
    case 'ZodNever': {
      out = { not: {} } as OpenApiSchema;
      break;
    }
    case 'ZodLiteral': {
      const v = (node as unknown as { _def: { value: unknown } })._def.value;
      out = fromLiteral(v);
      break;
    }
    case 'ZodEnum': {
      const values = (node as unknown as { _def: { values: readonly string[] } })._def.values;
      out = { type: 'string', enum: [...values] };
      break;
    }
    case 'ZodNativeEnum': {
      const values = Object.values(
        (node as unknown as { _def: { values: Record<string, unknown> } })._def.values,
      );
      const allStrings = values.every((v) => typeof v === 'string');
      out = { type: allStrings ? 'string' : 'number', enum: values };
      break;
    }
    case 'ZodArray': {
      const def = (node as unknown as { _def: { type: z.ZodTypeAny } })._def;
      out = { type: 'array', items: convert(def.type, ctx) };
      applyArrayChecks(node, out);
      break;
    }
    case 'ZodTuple': {
      const def = (node as unknown as { _def: { items: readonly z.ZodTypeAny[] } })._def;
      out = {
        type: 'array',
        // OpenAPI 3.1 supports `prefixItems` (JSON Schema 2020-12).
        ...({ prefixItems: def.items.map((c) => convert(c, ctx)) } as Record<string, unknown>),
        items: false as unknown as OpenApiSchema,
        minItems: def.items.length,
        maxItems: def.items.length,
      };
      break;
    }
    case 'ZodObject': {
      out = emitObject(node, ctx);
      break;
    }
    case 'ZodRecord': {
      const def = (node as unknown as { _def: { valueType: z.ZodTypeAny } })._def;
      out = { type: 'object', additionalProperties: convert(def.valueType, ctx) };
      break;
    }
    case 'ZodMap': {
      // Wire-format: serialise as an object keyed by string.
      const def = (node as unknown as { _def: { valueType: z.ZodTypeAny } })._def;
      out = { type: 'object', additionalProperties: convert(def.valueType, ctx) };
      break;
    }
    case 'ZodSet': {
      const def = (node as unknown as { _def: { valueType: z.ZodTypeAny } })._def;
      out = {
        type: 'array',
        items: convert(def.valueType, ctx),
        uniqueItems: true,
      } as OpenApiSchema;
      break;
    }
    case 'ZodNullable': {
      const def = (node as unknown as { _def: { innerType: z.ZodTypeAny } })._def;
      out = nullable(convert(def.innerType, ctx));
      break;
    }
    case 'ZodOptional': {
      const def = (node as unknown as { _def: { innerType: z.ZodTypeAny } })._def;
      out = convert(def.innerType, ctx);
      break;
    }
    case 'ZodUnion': {
      const def = (node as unknown as { _def: { options: readonly z.ZodTypeAny[] } })._def;
      out = { anyOf: def.options.map((o) => convert(o, ctx)) };
      break;
    }
    case 'ZodDiscriminatedUnion': {
      const def = (
        node as unknown as {
          _def: { options: readonly z.ZodTypeAny[]; discriminator: string };
        }
      )._def;
      out = {
        oneOf: def.options.map((o) => convert(o, ctx)),
        discriminator: { propertyName: def.discriminator },
      };
      break;
    }
    case 'ZodIntersection': {
      const def = (node as unknown as { _def: { left: z.ZodTypeAny; right: z.ZodTypeAny } })._def;
      out = { allOf: [convert(def.left, ctx), convert(def.right, ctx)] };
      break;
    }
    case 'ZodLazy': {
      const def = (node as unknown as { _def: { getter: () => z.ZodTypeAny } })._def;
      // After the FIRST call into the lazy getter we no longer want to
      // expand any further re-references — they should emit `$ref`s.
      // Drop `expandingSelf` after we've crossed the lazy boundary.
      const prevSelf = ctx.expandingSelf;
      ctx.expandingSelf = undefined;
      ctx.inFlight.add(node);
      try {
        out = convert(def.getter(), ctx);
      } finally {
        ctx.inFlight.delete(node);
        ctx.expandingSelf = prevSelf;
      }
      break;
    }
    default: {
      // Fallback: emit `{}` so the spec still validates rather than
      // throwing during build. The test suite asserts no operation
      // ends up purely empty.
      out = {};
    }
  }

  if (desc !== undefined && out.$ref === undefined && out.description === undefined) {
    out.description = desc;
  }
  return out;
}

/** Public-facing converter context factory. */
export function makeContext(
  components: Record<string, OpenApiSchema>,
  nameByRef: Map<z.ZodTypeAny, string>,
): ConvertContext {
  return { components, nameByRef, inFlight: new Set() };
}
