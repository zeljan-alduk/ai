/**
 * Pure form-state logic for the new-evaluator dialog.
 *
 * Lives in its own module so vitest can exercise it without React or
 * the network. Each `kind` has its own config shape — we model that
 * here so the dialog renders the right fields and so the test panel
 * can stay declarative.
 *
 * LLM-agnostic: the llm_judge form carries a capability-class string
 * (e.g. `reasoning-medium`); the gateway picks the actual model.
 */

import type { CreateEvaluatorRequest, EvaluatorConfig, EvaluatorKind } from '@aldo-ai/api-contract';

export const EVALUATOR_KINDS: ReadonlyArray<EvaluatorKind> = [
  'exact_match',
  'contains',
  'regex',
  'json_schema',
  'llm_judge',
];

export const KIND_LABELS: Record<EvaluatorKind, string> = {
  exact_match: 'Exact match',
  contains: 'Contains substring',
  regex: 'Regex',
  json_schema: 'JSON schema',
  llm_judge: 'LLM judge',
};

export const KIND_DESCRIPTIONS: Record<EvaluatorKind, string> = {
  exact_match: 'Pass when the output equals the expected value.',
  contains: 'Pass when the output contains the expected substring.',
  regex: 'Pass when the regex matches the output.',
  json_schema: 'Pass when the output validates against a JSON schema.',
  llm_judge: 'Use a model to score the output against a prompt template.',
};

/** Capability classes the gateway exposes — opaque, never branded. */
export const JUDGE_CAPABILITY_CLASSES: ReadonlyArray<string> = [
  'reasoning-light',
  'reasoning-medium',
  'reasoning-heavy',
  'cheap-fast',
];

export interface EvaluatorDraft {
  name: string;
  kind: EvaluatorKind;
  isShared: boolean;
  // Per-kind config fields. Only the ones for the current kind are
  // read by `draftToConfig()` — the others are kept around so the
  // user doesn't lose work when switching back.
  exactMatch: { value: string; trim: boolean };
  contains: { value: string };
  regex: { value: string };
  jsonSchema: { schema: string }; // raw JSON
  llmJudge: {
    modelClass: string;
    prompt: string;
    outputSchema: string; // raw JSON
  };
}

export function emptyDraft(): EvaluatorDraft {
  return {
    name: '',
    kind: 'exact_match',
    isShared: false,
    exactMatch: { value: '', trim: true },
    contains: { value: '' },
    regex: { value: '' },
    jsonSchema: { schema: '{\n  "type": "object"\n}' },
    llmJudge: {
      modelClass: 'reasoning-medium',
      prompt:
        'Compare {{output}} against the expected {{expected}}.\nReturn JSON {"passed": true|false, "score": 0..1, "reason": "..."}.',
      outputSchema:
        '{\n  "type": "object",\n  "required": ["passed", "score"],\n  "properties": {\n    "passed": { "type": "boolean" },\n    "score": { "type": "number" }\n  }\n}',
    },
  };
}

export interface DraftValidation {
  ok: boolean;
  errors: { field: string; message: string }[];
}

export function validateDraft(draft: EvaluatorDraft): DraftValidation {
  const errors: { field: string; message: string }[] = [];
  if (!draft.name.trim()) errors.push({ field: 'name', message: 'Name is required.' });
  if (draft.name.length > 160) {
    errors.push({ field: 'name', message: 'Name must be <= 160 characters.' });
  }

  switch (draft.kind) {
    case 'exact_match':
      if (draft.exactMatch.value.length === 0) {
        errors.push({ field: 'value', message: 'Expected value is required.' });
      }
      break;
    case 'contains':
      if (draft.contains.value.length === 0) {
        errors.push({ field: 'value', message: 'Substring is required.' });
      }
      break;
    case 'regex':
      if (draft.regex.value.length === 0) {
        errors.push({ field: 'value', message: 'Regex pattern is required.' });
      } else {
        try {
          new RegExp(draft.regex.value);
        } catch (err) {
          errors.push({ field: 'value', message: `Invalid regex: ${(err as Error).message}` });
        }
      }
      break;
    case 'json_schema':
      try {
        const parsed = JSON.parse(draft.jsonSchema.schema);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          errors.push({ field: 'schema', message: 'Schema must be a JSON object.' });
        }
      } catch (err) {
        errors.push({ field: 'schema', message: `Invalid JSON: ${(err as Error).message}` });
      }
      break;
    case 'llm_judge':
      if (!draft.llmJudge.modelClass) {
        errors.push({ field: 'modelClass', message: 'Pick a capability class.' });
      }
      if (draft.llmJudge.prompt.trim().length === 0) {
        errors.push({ field: 'prompt', message: 'Prompt template is required.' });
      } else if (
        !draft.llmJudge.prompt.includes('{{output}}') &&
        !draft.llmJudge.prompt.includes('{{expected}}') &&
        !draft.llmJudge.prompt.includes('{{input}}')
      ) {
        errors.push({
          field: 'prompt',
          message: 'Prompt should reference at least one of {{input}}, {{output}}, {{expected}}.',
        });
      }
      try {
        const parsed = JSON.parse(draft.llmJudge.outputSchema);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          errors.push({ field: 'outputSchema', message: 'Output schema must be a JSON object.' });
        }
      } catch (err) {
        errors.push({
          field: 'outputSchema',
          message: `Invalid JSON: ${(err as Error).message}`,
        });
      }
      break;
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Marshal the active section of the draft into the on-the-wire
 * EvaluatorConfig. Caller must have already validated.
 */
export function draftToConfig(draft: EvaluatorDraft): EvaluatorConfig {
  switch (draft.kind) {
    case 'exact_match':
      return { value: draft.exactMatch.value, trim: draft.exactMatch.trim };
    case 'contains':
      return { value: draft.contains.value };
    case 'regex':
      return { value: draft.regex.value };
    case 'json_schema':
      return { schema: JSON.parse(draft.jsonSchema.schema) };
    case 'llm_judge':
      return {
        model_class: draft.llmJudge.modelClass,
        prompt: draft.llmJudge.prompt,
        output_schema: JSON.parse(draft.llmJudge.outputSchema),
      };
  }
}

/**
 * Top-level convenience — produce the CreateEvaluatorRequest body. The
 * dialog passes the result straight to `createEvaluator()`.
 */
export function draftToCreateRequest(draft: EvaluatorDraft): CreateEvaluatorRequest {
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    config: draftToConfig(draft),
    isShared: draft.isShared,
  };
}
