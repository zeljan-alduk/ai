declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type RunId = Brand<string, 'RunId'>;
export type CheckpointId = Brand<string, 'CheckpointId'>;
export type TraceId = Brand<string, 'TraceId'>;
export type SpanId = Brand<string, 'SpanId'>;
export type AgentName = Brand<string, 'AgentName'>;
export type ModelId = Brand<string, 'ModelId'>;
export type ProviderId = Brand<string, 'ProviderId'>;
