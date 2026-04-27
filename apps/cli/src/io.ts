/**
 * Shared I/O surface. Commands write through a `CliIO` rather than `console`
 * so tests can capture output and assert against it.
 */

export interface CliIO {
  readonly stdout: (chunk: string) => void;
  readonly stderr: (chunk: string) => void;
  readonly isTTY: boolean;
}

export function defaultIO(): CliIO {
  return {
    stdout: (s) => {
      process.stdout.write(s);
    },
    stderr: (s) => {
      process.stderr.write(s);
    },
    isTTY: Boolean(process.stdout.isTTY),
  };
}

/** Emit a JSON document followed by a newline. Stable key order up to caller. */
export function writeJson(io: CliIO, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

/** Emit a plain line (append newline if absent). */
export function writeLine(io: CliIO, line = ''): void {
  io.stdout(line.endsWith('\n') ? line : `${line}\n`);
}

/** Emit a plain error line (always newline-terminated). */
export function writeErr(io: CliIO, line: string): void {
  io.stderr(line.endsWith('\n') ? line : `${line}\n`);
}
