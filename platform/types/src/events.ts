export interface Event {
  readonly type: string;
  readonly at: string;
  readonly tenant: string;
  readonly payload: unknown;
  readonly attrs?: Readonly<Record<string, string | number | boolean>>;
}

export type Unsubscribe = () => Promise<void>;

export interface EventBus {
  publish(
    event: string,
    payload: unknown,
    attrs?: Readonly<Record<string, string | number | boolean>>,
  ): Promise<void>;

  subscribe(pattern: string, handler: (e: Event) => Promise<void>): Promise<Unsubscribe>;
}
