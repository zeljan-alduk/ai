/**
 * @aldo-ai/sandbox public types.
 *
 * The sandbox is a thin isolation boundary between the engine and arbitrary
 * tool code (native or MCP-server-spawned). It is provider-agnostic — no
 * model gateway concepts leak in here.
 *
 * v0 isolation: timeouts, env scrub, cwd jail, network egress allowlist,
 * setrlimit-style cpu/mem caps. Container-grade isolation (namespaces,
 * seccomp) is wave 8.
 */

export type SandboxErrorCode =
  | 'TIMEOUT'
  | 'OUT_OF_BOUNDS'
  | 'EGRESS_BLOCKED'
  | 'RUNTIME_ERROR'
  | 'LIMIT_EXCEEDED'
  | 'CANCELLED';

/**
 * Network policy. `'none'` blocks all egress. The allowlist is matched
 * by hostname (no port, no scheme). A hostname is permitted iff it equals
 * an entry exactly or is a subdomain of one. Wildcards aren't supported.
 */
export type SandboxNetworkPolicy =
  | 'none'
  | { readonly allowedHosts: readonly string[] };

/**
 * Resolved policy a sandbox adapter executes against. Constructed by
 * `buildPolicy` from an AgentSpec; never authored directly by tools.
 */
export interface SandboxPolicy {
  /** The cwd jail root. The function sees this as its working directory. */
  readonly cwd: string;
  /**
   * Realpath-checked filesystem roots the function may read. Anything
   * outside MUST raise `OUT_OF_BOUNDS`. The cwd jail is implicitly
   * included.
   */
  readonly allowedPaths: readonly string[];
  /** Only these env vars are made visible to the sandboxed function. */
  readonly env: Readonly<Record<string, string>>;
  /** Network egress policy. */
  readonly network: SandboxNetworkPolicy;
  /** Wall-clock timeout in milliseconds. */
  readonly timeoutMs: number;
  /** Optional RSS cap (subprocess only on linux). */
  readonly memoryLimitMb?: number;
  /** Optional CPU-time cap (subprocess only on linux). */
  readonly cpuLimitMs?: number;
}

export interface SandboxRequest<TArgs = unknown> {
  /** A stable label used in logs/errors. Not a security boundary. */
  readonly toolName: string;
  readonly args: TArgs;
  readonly policy: SandboxPolicy;
  /** Caller-supplied cancel signal. Adapters MUST honour this. */
  readonly signal?: AbortSignal;
}

export interface SandboxResult<TValue = unknown> {
  readonly value: TValue;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly peakRssMb?: number;
}

/**
 * Adapter contract. The shape of `fn` differs between adapters:
 *
 * - `InProcessSandbox` calls a thunk in-process (fn is a JS function).
 * - `SubprocessSandbox` evaluates a serialisable module entry; the
 *   "function" here is a `{ module: string, exportName: string }`
 *   reference resolved inside the child.
 *
 * Both surface the same {@link SandboxResult} / {@link SandboxError}
 * vocabulary so callers can swap drivers.
 */
export interface SandboxAdapter {
  readonly driver: SandboxDriver;
  run<TArgs, TValue>(
    fn: SandboxFn<TArgs, TValue>,
    req: SandboxRequest<TArgs>,
  ): Promise<SandboxResult<TValue>>;
}

export type SandboxDriver = 'in-process' | 'subprocess';

/**
 * The thing executed inside the sandbox. For `in-process`, `inline`
 * is a thunk. For `subprocess`, `module` points to an absolute path
 * that the child imports + invokes.
 */
export type SandboxFn<TArgs, TValue> =
  | {
      readonly kind: 'inline';
      readonly inline: (args: TArgs, scope: SandboxScope) => Promise<TValue> | TValue;
    }
  | {
      readonly kind: 'module';
      /** Absolute path to a JS/TS module the subprocess will `import()`. */
      readonly module: string;
      /** Named export to call. The export must be `(args) => Promise<value>`. */
      readonly exportName: string;
    };

/**
 * Scope the in-process adapter passes to inline functions. Lets the
 * tool body cooperate with cancellation and read its scrubbed env
 * without reaching into `process.env`.
 */
export interface SandboxScope {
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly signal: AbortSignal;
}

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly toolName: string;
  override readonly cause?: unknown;
  readonly stdout?: string;
  readonly stderr?: string;
  constructor(args: {
    code: SandboxErrorCode;
    toolName: string;
    message: string;
    cause?: unknown;
    stdout?: string;
    stderr?: string;
  }) {
    super(args.message);
    this.name = 'SandboxError';
    this.code = args.code;
    this.toolName = args.toolName;
    if (args.cause !== undefined) this.cause = args.cause;
    if (args.stdout !== undefined) this.stdout = args.stdout;
    if (args.stderr !== undefined) this.stderr = args.stderr;
  }
}
