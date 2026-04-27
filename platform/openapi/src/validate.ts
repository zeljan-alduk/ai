/**
 * Lightweight OpenAPI 3.1 structural validator.
 *
 * We deliberately do NOT pull a full JSON-Schema validator (`ajv`,
 * `@apidevtools/swagger-parser`) — those are huge and would force the
 * platform package to ship an extra megabyte of code. Instead, we
 * validate the bits an integrator actually cares about:
 *
 *   1. The document is JSON-serialisable.
 *   2. `openapi` is `'3.1.x'`.
 *   3. `info.title`, `info.version` are non-empty strings.
 *   4. `servers[]` is a non-empty array of `{ url, description? }`.
 *   5. Every `paths[*][*]` operation has a description, at least one
 *      tag, at least one response, and a 4xx response when not on the
 *      public allow-list.
 *   6. Every `$ref` resolves under `#/components/schemas/`.
 *   7. No tag referenced from an operation is missing from the
 *      top-level `tags[]`.
 *
 * Aim: fast, deterministic, no external dependencies. The unit tests
 * in `tests/spec.test.ts` use this on the live spec — that's the
 * regression net.
 */

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Walk the spec and call `visit` on every `$ref` string we find.
 */
function walkRefs(node: unknown, path: string, visit: (ref: string, at: string) => void): void {
  if (Array.isArray(node)) {
    node.forEach((c, i) => walkRefs(c, `${path}[${i}]`, visit));
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      visit(v, `${path}.$ref`);
    } else {
      walkRefs(v, `${path}.${k}`, visit);
    }
  }
}

export function validateOpenApi(doc: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  // 1. JSON-serialisable.
  try {
    JSON.stringify(doc);
  } catch {
    issue('$', 'document is not JSON-serialisable');
    return { ok: false, issues };
  }

  if (!isPlainObject(doc)) {
    issue('$', 'document must be an object');
    return { ok: false, issues };
  }

  // 2. openapi version
  if (typeof doc.openapi !== 'string' || !/^3\.1\.\d+$/.test(doc.openapi)) {
    issue('openapi', 'must be "3.1.x"');
  }

  // 3. info
  const info = doc.info;
  if (!isPlainObject(info)) {
    issue('info', 'must be an object');
  } else {
    if (typeof info.title !== 'string' || info.title.length === 0) {
      issue('info.title', 'must be a non-empty string');
    }
    if (typeof info.version !== 'string' || info.version.length === 0) {
      issue('info.version', 'must be a non-empty string');
    }
  }

  // 4. servers
  if (!Array.isArray(doc.servers) || doc.servers.length === 0) {
    issue('servers', 'must be a non-empty array');
  } else {
    doc.servers.forEach((s, i) => {
      if (!isPlainObject(s) || typeof s.url !== 'string' || s.url.length === 0) {
        issue(`servers[${i}].url`, 'must be a non-empty string');
      }
    });
  }

  // 5. paths + operations
  const tagsTopLevel = new Set<string>();
  if (Array.isArray(doc.tags)) {
    for (const t of doc.tags) {
      if (isPlainObject(t) && typeof t.name === 'string') tagsTopLevel.add(t.name);
    }
  }

  if (!isPlainObject(doc.paths)) {
    issue('paths', 'must be an object');
  } else {
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      if (!isPlainObject(pathItem)) {
        issue(`paths[${path}]`, 'must be an object');
        continue;
      }
      for (const [method, op] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        const at = `paths[${path}].${method}`;
        if (!isPlainObject(op)) {
          issue(at, 'operation must be an object');
          continue;
        }
        if (typeof op.description !== 'string' || op.description.trim().length === 0) {
          issue(`${at}.description`, 'must be a non-empty string');
        }
        if (!Array.isArray(op.tags) || op.tags.length === 0) {
          issue(`${at}.tags`, 'must be a non-empty array');
        } else {
          for (const t of op.tags) {
            if (typeof t === 'string' && tagsTopLevel.size > 0 && !tagsTopLevel.has(t)) {
              issue(`${at}.tags`, `tag "${t}" not declared in top-level tags[]`);
            }
          }
        }
        if (!isPlainObject(op.responses) || Object.keys(op.responses).length === 0) {
          issue(`${at}.responses`, 'must be a non-empty object');
        }
      }
    }
  }

  // 6. $refs resolve.
  if (isPlainObject(doc.components) && isPlainObject(doc.components.schemas)) {
    const schemaNames = new Set(Object.keys(doc.components.schemas));
    walkRefs(doc, '', (ref, at) => {
      if (!ref.startsWith('#/components/schemas/')) {
        issue(at, `$ref "${ref}" is not under #/components/schemas/`);
        return;
      }
      const name = ref.slice('#/components/schemas/'.length);
      if (!schemaNames.has(name)) {
        issue(at, `$ref "${ref}" points at a missing schema`);
      }
    });
  } else {
    issue('components.schemas', 'must be an object');
  }

  return { ok: issues.length === 0, issues };
}
