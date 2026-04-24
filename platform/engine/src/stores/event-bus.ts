import { EventEmitter } from 'node:events';
import type { Event, EventBus, Unsubscribe } from '@meridian/types';

/**
 * In-process EventBus backed by Node's EventEmitter. Supports simple
 * pattern matching: exact type match or trailing-wildcard match
 * ("foo.*" matches "foo.bar" and "foo.baz.qux").
 *
 * Multi-tenant isolation is a tenant-check on publish; v0 leaves it
 * to callers to supply the correct tenant.
 *
 * TODO(v1): back with Redis/NATS for cross-process delivery.
 */
export class InProcessEventBus implements EventBus {
  private readonly emitter = new EventEmitter();
  private readonly defaultTenant: string;

  constructor(defaultTenant = 'default') {
    this.defaultTenant = defaultTenant;
    // Unbounded — tests can register many listeners.
    this.emitter.setMaxListeners(0);
  }

  async publish(
    event: string,
    payload: unknown,
    attrs?: Readonly<Record<string, string | number | boolean>>,
  ): Promise<void> {
    const e: Event = {
      type: event,
      at: new Date().toISOString(),
      tenant: this.defaultTenant,
      payload,
      ...(attrs !== undefined ? { attrs } : {}),
    };
    // Emit on the exact channel and the wildcard channel.
    this.emitter.emit('__any__', e);
    this.emitter.emit(event, e);
  }

  async subscribe(pattern: string, handler: (e: Event) => Promise<void>): Promise<Unsubscribe> {
    const wrap = (e: Event): void => {
      if (!matches(pattern, e.type)) return;
      // Best-effort: surface handler errors on the emitter.
      void handler(e).catch((err) => {
        this.emitter.emit('error', err);
      });
    };
    // If the pattern is an exact literal (no wildcard), listen directly on it
    // for efficiency; otherwise use the catch-all channel.
    const channel = pattern.includes('*') ? '__any__' : pattern;
    this.emitter.on(channel, wrap);
    const emitter = this.emitter;
    return async () => {
      emitter.off(channel, wrap);
    };
  }
}

function matches(pattern: string, type: string): boolean {
  if (pattern === type) return true;
  if (pattern === '*' || pattern === '**') return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return type === prefix || type.startsWith(`${prefix}.`);
  }
  return false;
}
