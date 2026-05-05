/**
 * Persistent-session shell tools — shell.cd / shell.pwd / shell.export /
 * shell.unset / shell.env.
 *
 * Closes the gap between aldo-shell and what humans expect from a
 * shell: `cd ../foo` should affect the next `ls`. The MCP server
 * process lifetime IS the session, so we keep state in a single
 * mutable struct (see session.ts).
 *
 * Each tool here is a thin layer over the helpers in session.ts so
 * the test surface stays small.
 */

import { z } from 'zod';
import {
  type ShellSessionState,
  applyShellCd,
  applyShellExport,
  applyShellUnset,
} from '../session.js';

// ---------- shell.cd --------------------------------------------------------

export const cdInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe(
        'Target directory. Relative paths resolve against the current cwd; absolute paths are used as-is.',
      ),
  })
  .strict();

export const cdOutputSchema = z
  .object({
    cwd: z.string().describe('The new session cwd.'),
  })
  .strict();

export type CdInput = z.infer<typeof cdInputSchema>;
export type CdOutput = z.infer<typeof cdOutputSchema>;

export async function shellCd(state: ShellSessionState, input: CdInput): Promise<CdOutput> {
  const next = applyShellCd(state, input.path);
  return { cwd: next };
}

// ---------- shell.pwd -------------------------------------------------------

export const pwdInputSchema = z.object({}).strict();
export const pwdOutputSchema = z
  .object({
    cwd: z.string().nullable().describe('Current session cwd, or null when none has been set.'),
  })
  .strict();

export type PwdInput = z.infer<typeof pwdInputSchema>;
export type PwdOutput = z.infer<typeof pwdOutputSchema>;

export async function shellPwd(state: ShellSessionState, _input: PwdInput): Promise<PwdOutput> {
  return { cwd: state.cwd };
}

// ---------- shell.export ----------------------------------------------------

export const exportInputSchema = z
  .object({
    pairs: z
      .record(z.string())
      .describe('Map of NAME → value to merge onto the session env.'),
  })
  .strict();

export const exportOutputSchema = z
  .object({
    keys: z.array(z.string()).describe('Keys after the merge (sorted).'),
  })
  .strict();

export type ExportInput = z.infer<typeof exportInputSchema>;
export type ExportOutput = z.infer<typeof exportOutputSchema>;

export async function shellExport(
  state: ShellSessionState,
  input: ExportInput,
): Promise<ExportOutput> {
  applyShellExport(state, input.pairs);
  return { keys: Object.keys(state.env).sort() };
}

// ---------- shell.unset -----------------------------------------------------

export const unsetInputSchema = z
  .object({
    keys: z.array(z.string().min(1)).min(1).describe('Names to remove from the session env.'),
  })
  .strict();

export const unsetOutputSchema = z
  .object({
    remaining: z.array(z.string()).describe('Keys still set after the unset (sorted).'),
  })
  .strict();

export type UnsetInput = z.infer<typeof unsetInputSchema>;
export type UnsetOutput = z.infer<typeof unsetOutputSchema>;

export async function shellUnset(
  state: ShellSessionState,
  input: UnsetInput,
): Promise<UnsetOutput> {
  applyShellUnset(state, input.keys);
  return { remaining: Object.keys(state.env).sort() };
}

// ---------- shell.env -------------------------------------------------------

export const envInputSchema = z.object({}).strict();
export const envOutputSchema = z
  .object({
    pairs: z.record(z.string()).describe('Current session env (excluding host process.env).'),
  })
  .strict();

export type EnvInput = z.infer<typeof envInputSchema>;
export type EnvOutput = z.infer<typeof envOutputSchema>;

export async function shellEnv(state: ShellSessionState, _input: EnvInput): Promise<EnvOutput> {
  return { pairs: { ...state.env } };
}
