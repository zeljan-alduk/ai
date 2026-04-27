/**
 * Wave-16 — pure-logic tests for the New Evaluator dialog form state.
 *
 * Covered:
 *   - emptyDraft + KIND_LABELS / KIND_DESCRIPTIONS coverage of every kind
 *   - validateDraft per kind (happy + at least one failure)
 *   - draftToConfig marshalling for each kind
 *   - draftToCreateRequest envelope
 */

import { describe, expect, it } from 'vitest';
import {
  EVALUATOR_KINDS,
  KIND_DESCRIPTIONS,
  KIND_LABELS,
  draftToConfig,
  draftToCreateRequest,
  emptyDraft,
  validateDraft,
} from './evaluator-form';

describe('emptyDraft + label maps', () => {
  it('emptyDraft starts on exact_match with sane judge defaults', () => {
    const d = emptyDraft();
    expect(d.kind).toBe('exact_match');
    expect(d.exactMatch.trim).toBe(true);
    expect(d.llmJudge.modelClass).toBe('reasoning-medium');
    expect(d.llmJudge.prompt).toMatch(/{{output}}/);
  });

  it('every EvaluatorKind has a label + description', () => {
    for (const k of EVALUATOR_KINDS) {
      expect(typeof KIND_LABELS[k]).toBe('string');
      expect(typeof KIND_DESCRIPTIONS[k]).toBe('string');
    }
  });
});

describe('validateDraft', () => {
  it('exact_match needs a non-empty value', () => {
    const d = emptyDraft();
    d.name = 'em';
    d.kind = 'exact_match';
    d.exactMatch.value = '';
    expect(validateDraft(d).ok).toBe(false);
    d.exactMatch.value = 'hello';
    expect(validateDraft(d).ok).toBe(true);
  });

  it('contains needs a non-empty substring', () => {
    const d = emptyDraft();
    d.name = 'c';
    d.kind = 'contains';
    expect(validateDraft(d).ok).toBe(false);
    d.contains.value = 'x';
    expect(validateDraft(d).ok).toBe(true);
  });

  it('regex rejects malformed patterns', () => {
    const d = emptyDraft();
    d.name = 'r';
    d.kind = 'regex';
    d.regex.value = '[';
    const r = validateDraft(d);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toMatch(/Invalid regex/);
  });

  it('json_schema rejects non-object roots', () => {
    const d = emptyDraft();
    d.name = 'js';
    d.kind = 'json_schema';
    d.jsonSchema.schema = '[]';
    expect(validateDraft(d).ok).toBe(false);
    d.jsonSchema.schema = '{"type":"object"}';
    expect(validateDraft(d).ok).toBe(true);
  });

  it('llm_judge requires {{output}}/{{expected}}/{{input}} reference', () => {
    const d = emptyDraft();
    d.name = 'judge';
    d.kind = 'llm_judge';
    d.llmJudge.prompt = 'no placeholders here';
    expect(validateDraft(d).ok).toBe(false);
    d.llmJudge.prompt = 'compare {{output}} to baseline';
    expect(validateDraft(d).ok).toBe(true);
  });

  it('rejects empty name regardless of kind', () => {
    const d = emptyDraft();
    d.name = '';
    d.kind = 'contains';
    d.contains.value = 'x';
    const r = validateDraft(d);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.field).toBe('name');
  });
});

describe('draftToConfig + draftToCreateRequest', () => {
  it('marshals exact_match', () => {
    const d = emptyDraft();
    d.exactMatch.value = 'ok';
    d.exactMatch.trim = false;
    expect(draftToConfig(d)).toEqual({ value: 'ok', trim: false });
  });

  it('marshals contains', () => {
    const d = emptyDraft();
    d.kind = 'contains';
    d.contains.value = 'foo';
    expect(draftToConfig(d)).toEqual({ value: 'foo' });
  });

  it('marshals regex', () => {
    const d = emptyDraft();
    d.kind = 'regex';
    d.regex.value = '^foo';
    expect(draftToConfig(d)).toEqual({ value: '^foo' });
  });

  it('marshals json_schema (parses the JSON string into an object)', () => {
    const d = emptyDraft();
    d.kind = 'json_schema';
    d.jsonSchema.schema = '{"type":"object","required":["x"]}';
    expect(draftToConfig(d)).toEqual({ schema: { type: 'object', required: ['x'] } });
  });

  it('marshals llm_judge with parsed output_schema and capability class', () => {
    const d = emptyDraft();
    d.kind = 'llm_judge';
    d.llmJudge.modelClass = 'reasoning-heavy';
    d.llmJudge.outputSchema = '{"type":"object"}';
    const cfg = draftToConfig(d) as Record<string, unknown>;
    expect(cfg.model_class).toBe('reasoning-heavy');
    expect(cfg.output_schema).toEqual({ type: 'object' });
    expect(typeof cfg.prompt).toBe('string');
  });

  it('draftToCreateRequest trims the name and forwards isShared', () => {
    const d = emptyDraft();
    d.name = '  my-eval  ';
    d.exactMatch.value = 'ok';
    d.isShared = true;
    const req = draftToCreateRequest(d);
    expect(req.name).toBe('my-eval');
    expect(req.kind).toBe('exact_match');
    expect(req.isShared).toBe(true);
    expect(req.config).toEqual({ value: 'ok', trim: true });
  });
});
