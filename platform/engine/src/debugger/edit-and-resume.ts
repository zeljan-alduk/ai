import type {
  AgentRun,
  CheckpointId,
  Message,
  MessagePart,
  RunOverrides,
  TextPart,
} from '@aldo-ai/types';
import type { Checkpoint, Checkpointer } from '../checkpointer/index.js';

export interface EditAndResumeArgs {
  readonly checkpointId: CheckpointId;
  /** 0-based index into the checkpoint's `messages` array. */
  readonly messageIndex: number;
  /** Replacement text. The first text part of the message has its `text` set. */
  readonly newText: string;
  readonly overrides?: RunOverrides;
}

/**
 * Owner-agnostic helper used by `AgentRun.editAndResume` and by the
 * standalone `editAndResume` export. Loads the checkpoint, splices in a
 * replacement message, persists a fresh checkpoint with the rewritten
 * history, and hands the new checkpoint id back. The caller resumes
 * from it via `AgentRun.resume(newCheckpointId)`.
 *
 * We deliberately persist a NEW checkpoint rather than mutate the
 * existing row — the original is part of the audit trail and replays
 * may still need it. The new checkpoint shares the original's
 * `nodePath`, `phase`, `rngSeed`, `toolResults`, `state`, and
 * (optionally overridden) `overrides`.
 */
export async function rewriteCheckpoint(
  checkpointer: Checkpointer,
  args: EditAndResumeArgs,
): Promise<{ readonly newCheckpointId: CheckpointId; readonly base: Checkpoint }> {
  const cp = await checkpointer.load(args.checkpointId);
  if (!cp) throw new Error(`checkpoint not found: ${args.checkpointId}`);
  if (args.messageIndex < 0 || args.messageIndex >= cp.messages.length) {
    throw new Error(`messageIndex out of range: ${args.messageIndex} (have ${cp.messages.length})`);
  }

  const target = cp.messages[args.messageIndex] as Message;
  const rewritten = rewriteMessageText(target, args.newText);
  const messages: Message[] = [...cp.messages];
  messages[args.messageIndex] = rewritten;

  const next: Omit<Checkpoint, 'id' | 'at'> = {
    runId: cp.runId,
    nodePath: cp.nodePath,
    phase: cp.phase,
    messages,
    toolResults: cp.toolResults,
    rngSeed: cp.rngSeed,
    io: cp.io,
    state: cp.state,
    ...(args.overrides !== undefined
      ? { overrides: args.overrides }
      : cp.overrides !== undefined
        ? { overrides: cp.overrides }
        : {}),
  };
  const newCheckpointId = await checkpointer.save(next);
  return { newCheckpointId, base: cp };
}

/**
 * Standalone edit-and-resume entry point. Useful when the caller has the
 * `AgentRun` and `Checkpointer` directly but doesn't want to depend on
 * the `editAndResume` method on `AgentRun`.
 *
 * Returns the new `AgentRun` produced by `agentRun.resume(newCheckpointId)`.
 */
export async function editAndResume(
  agentRun: AgentRun,
  checkpointer: Checkpointer,
  args: EditAndResumeArgs,
): Promise<AgentRun> {
  const { newCheckpointId } = await rewriteCheckpoint(checkpointer, args);
  return agentRun.resume(newCheckpointId, args.overrides);
}

/**
 * Replace the text of `msg`. We rewrite the first `text` part if one
 * exists, otherwise prepend a new text part — this preserves any tool
 * calls or images already attached to the message.
 */
function rewriteMessageText(msg: Message, newText: string): Message {
  const idx = msg.content.findIndex((p): p is TextPart => p.type === 'text');
  let nextContent: readonly MessagePart[];
  if (idx === -1) {
    nextContent = [{ type: 'text', text: newText }, ...msg.content];
  } else {
    const copy = [...msg.content];
    copy[idx] = { type: 'text', text: newText };
    nextContent = copy;
  }
  return { ...msg, content: nextContent };
}
