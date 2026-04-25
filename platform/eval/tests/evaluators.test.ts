import type { CallContext, CompletionRequest, Delta, ModelGateway } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  evaluateContains,
  evaluateExact,
  evaluateJsonSchema,
  evaluateNotContains,
  evaluateRegex,
  evaluateRubric,
} from '../src/evaluators/index.js';
import { parseVerdict } from '../src/evaluators/rubric.js';

describe('contains / not_contains', () => {
  it('contains: hit returns score 1', () => {
    const r = evaluateContains('hello world', 'world');
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });

  it('contains: miss returns score 0', () => {
    const r = evaluateContains('hello world', 'goodbye');
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
  });

  it('not_contains: hit fails', () => {
    const r = evaluateNotContains('hello world', 'world');
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
  });

  it('not_contains: miss passes', () => {
    const r = evaluateNotContains('hello world', 'goodbye');
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });
});

describe('regex', () => {
  it('valid pattern that matches', () => {
    const r = evaluateRegex('order #1234 placed', /#\d+/.source);
    expect(r.passed).toBe(true);
    expect((r.detail as { match: string }).match).toBe('#1234');
  });

  it('valid pattern that does not match', () => {
    const r = evaluateRegex('no numbers here', /#\d+/.source);
    expect(r.passed).toBe(false);
  });

  it('invalid pattern returns score 0 with error', () => {
    const r = evaluateRegex('any input', '(unclosed');
    expect(r.passed).toBe(false);
    expect((r.detail as { error: string }).error).toMatch(/invalid regex/);
  });
});

describe('exact', () => {
  it('exact match (trimmed) passes', () => {
    const r = evaluateExact('  hello\n', 'hello');
    expect(r.passed).toBe(true);
  });

  it('different content fails', () => {
    const r = evaluateExact('hello', 'world');
    expect(r.passed).toBe(false);
  });
});

describe('json_schema', () => {
  it('object with required fields and type checks passes', () => {
    const out = JSON.stringify({ verdict: 'approve', findings: [] });
    const r = evaluateJsonSchema(out, {
      type: 'object',
      required: ['verdict'],
      properties: {
        verdict: { type: 'string', enum: ['approve', 'request_changes', 'comment'] },
        findings: { type: 'array' },
      },
    });
    expect(r.passed).toBe(true);
  });

  it('missing required field fails', () => {
    const out = JSON.stringify({ findings: [] });
    const r = evaluateJsonSchema(out, {
      type: 'object',
      required: ['verdict'],
    });
    expect(r.passed).toBe(false);
    expect((r.detail as { errors: { path: string }[] }).errors[0]?.path).toBe('$.verdict');
  });

  it('wrong type fails', () => {
    const r = evaluateJsonSchema(JSON.stringify({ x: 'not-a-number' }), {
      type: 'object',
      properties: { x: { type: 'number' } },
    });
    expect(r.passed).toBe(false);
  });

  it('non-JSON output fails with parse error', () => {
    const r = evaluateJsonSchema('not json at all', { type: 'object' });
    expect(r.passed).toBe(false);
    expect((r.detail as { errors: { message: string }[] }).errors[0]?.message).toMatch(
      /not valid JSON/,
    );
  });

  it('enum mismatch fails', () => {
    const r = evaluateJsonSchema(JSON.stringify({ v: 'maybe' }), {
      type: 'object',
      properties: { v: { type: 'string', enum: ['yes', 'no'] } },
    });
    expect(r.passed).toBe(false);
  });

  it('items schema validates each array element', () => {
    const r = evaluateJsonSchema(JSON.stringify([1, 2, 'three']), {
      type: 'array',
      items: { type: 'integer' },
    });
    expect(r.passed).toBe(false);
    const errs = (r.detail as { errors: { path: string }[] }).errors;
    expect(errs.some((e) => e.path === '$[2]')).toBe(true);
  });
});

describe('rubric (LLM-as-judge)', () => {
  function judgeGateway(verdict: string): ModelGateway {
    return {
      async *complete(_req: CompletionRequest, _ctx: CallContext): AsyncIterable<Delta> {
        yield { textDelta: verdict };
        yield {
          end: {
            finishReason: 'stop',
            usage: {
              provider: 'mock',
              model: 'judge-1',
              tokensIn: 1,
              tokensOut: 1,
              usd: 0,
              at: new Date().toISOString(),
            },
            model: {
              id: 'judge-1',
              provider: 'mock',
              locality: 'local',
              provides: [],
              cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
              privacyAllowed: ['public', 'internal', 'sensitive'],
              capabilityClass: 'reasoning-medium',
              effectiveContextTokens: 8192,
            },
          },
        };
      },
      async embed() {
        return [];
      },
    };
  }

  it('YES => score 1, passes', async () => {
    const r = await evaluateRubric('any output', 'criterion', 'reasoning-medium', {
      gateway: judgeGateway('YES'),
      tenant: 'test',
    });
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
  });

  it('NO => score 0, fails', async () => {
    const r = await evaluateRubric('any output', 'criterion', 'reasoning-medium', {
      gateway: judgeGateway('NO'),
      tenant: 'test',
    });
    expect(r.score).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('partial SCORE: 0.85 parses and passes the 0.8 threshold', async () => {
    const r = await evaluateRubric('any output', 'criterion', 'reasoning-medium', {
      gateway: judgeGateway('SCORE: 0.85'),
      tenant: 'test',
    });
    expect(r.score).toBeCloseTo(0.85);
    expect(r.passed).toBe(true);
  });

  it('partial SCORE: 0.5 parses but does NOT pass (threshold is 0.8)', async () => {
    const r = await evaluateRubric('any output', 'criterion', 'reasoning-medium', {
      gateway: judgeGateway('SCORE: 0.5'),
      tenant: 'test',
    });
    expect(r.score).toBeCloseTo(0.5);
    expect(r.passed).toBe(false);
  });

  it('parseVerdict accepts a bare numeric reply', () => {
    expect(parseVerdict('0.9').score).toBeCloseTo(0.9);
    expect(parseVerdict('   0.42  ').score).toBeCloseTo(0.42);
  });

  it('parseVerdict clamps out-of-range numbers', () => {
    expect(parseVerdict('SCORE: 1.5').score).toBe(1);
    expect(parseVerdict('SCORE: -0.3').score).toBe(0);
  });

  it('parseVerdict treats unparseable replies as NO', () => {
    expect(parseVerdict('I refuse to answer').score).toBe(0);
    expect(parseVerdict('').score).toBe(0);
  });
});

describe('evaluate (dispatcher)', () => {
  it('routes contains', async () => {
    const r = await evaluate('hello world', { kind: 'contains', value: 'world' });
    expect(r.passed).toBe(true);
  });

  it('rubric without judgeGateway returns failure', async () => {
    const r = await evaluate('out', {
      kind: 'rubric',
      criterion: 'is good',
      judgeCapabilityClass: 'reasoning-medium',
    });
    expect(r.passed).toBe(false);
    expect((r.detail as { error: string }).error).toMatch(/judgeGateway/);
  });
});
