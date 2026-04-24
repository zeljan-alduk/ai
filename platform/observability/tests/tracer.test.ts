import { trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Aldo, GenAI, attrs } from '../src/attrs.js';
import { createTracer } from '../src/tracer.js';

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

beforeAll(() => {
  provider = new NodeTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
});

describe('tracer.span', () => {
  it('records expected GenAI attrs for a model_call', async () => {
    const tracer = createTracer({ serviceName: 'test' });
    await tracer.span(
      'llm.chat',
      'model_call',
      attrs.modelCall({
        system: 'anthropic',
        requestModel: 'claude-opus-4',
        inputTokens: 100,
        outputTokens: 50,
      }),
      async (s) => {
        s.setAttr(GenAI.RESPONSE_MODEL, 'claude-opus-4-20260101');
      },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    if (!span) throw new Error('no span');
    expect(span.name).toBe('llm.chat');
    expect(span.attributes[GenAI.SYSTEM]).toBe('anthropic');
    expect(span.attributes[GenAI.REQUEST_MODEL]).toBe('claude-opus-4');
    expect(span.attributes[GenAI.USAGE_INPUT_TOKENS]).toBe(100);
    expect(span.attributes[GenAI.USAGE_OUTPUT_TOKENS]).toBe(50);
    expect(span.attributes[GenAI.RESPONSE_MODEL]).toBe('claude-opus-4-20260101');
    expect(span.attributes[GenAI.OPERATION_NAME]).toBe('chat');
    expect(span.attributes[Aldo.KIND]).toBe('model_call');
  });

  it('tool_call stamps gen_ai.operation.name = execute_tool', async () => {
    const tracer = createTracer({ serviceName: 'test' });
    await tracer.span(
      'tool.run',
      'tool_call',
      attrs.toolCall({ toolName: 'search' }),
      async () => undefined,
    );

    const span = exporter.getFinishedSpans()[0];
    if (!span) throw new Error('no span');
    expect(span.attributes[GenAI.OPERATION_NAME]).toBe('execute_tool');
    expect(span.attributes[GenAI.TOOL_NAME]).toBe('search');
  });

  it('records exception and ends with error status on thrown fn', async () => {
    const tracer = createTracer({ serviceName: 'test' });
    const boom = new Error('boom');
    await expect(
      tracer.span('failing', 'node', {}, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const span = exporter.getFinishedSpans()[0];
    if (!span) throw new Error('no span');
    expect(span.status.code).toBe(2); // ERROR
    expect(span.status.message).toBe('boom');
    expect(span.events.length).toBeGreaterThanOrEqual(1);
    const exEvent = span.events.find((e) => e.name === 'exception');
    expect(exEvent).toBeDefined();
  });

  it('nested spans produce correct parent/child relationships', async () => {
    const tracer = createTracer({ serviceName: 'test' });
    await tracer.span('parent', 'run', {}, async () => {
      await tracer.span('child', 'node', {}, async () => {
        await tracer.span('grandchild', 'model_call', {}, async () => undefined);
      });
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const byName = new Map(spans.map((s) => [s.name, s]));
    const parent = byName.get('parent');
    const child = byName.get('child');
    const grand = byName.get('grandchild');
    if (!parent || !child || !grand) throw new Error('missing span');

    expect(child.parentSpanId).toBe(parent.spanContext().spanId);
    expect(grand.parentSpanId).toBe(child.spanContext().spanId);
    // All share the same trace.
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(grand.spanContext().traceId).toBe(parent.spanContext().traceId);
  });

  it('returns the fn result', async () => {
    const tracer = createTracer({ serviceName: 'test' });
    const result = await tracer.span('x', 'node', {}, async () => 42);
    expect(result).toBe(42);
  });
});

describe('tracer no-op fallback', () => {
  it('noop tracer still runs fn and returns value when forced', async () => {
    // Even though a provider is registered globally, `noop: true` forces the flag.
    const tracer = createTracer({ serviceName: 'test', noop: true });
    const result = await tracer.span('n', 'node', {}, async () => 'ok');
    expect(result).toBe('ok');
  });

  it('before any provider registration, getTracer returns a working tracer', () => {
    // Probe: getting a tracer from the API always succeeds.
    const t = trace.getTracer('probe');
    const s = t.startSpan('x');
    expect(typeof s.spanContext().spanId).toBe('string');
    s.end();
  });
});
