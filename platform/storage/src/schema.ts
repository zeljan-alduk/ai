/**
 * Drizzle ORM schema for the ALDO AI persistence layer.
 *
 * NOTE: the SQL of record lives in `migrations/001_init.sql`. This file
 * exists so callers (and future Drizzle-Kit codegen) can build typed
 * queries against the same shape — but we deliberately don't run Drizzle
 * migrations from here. Plain SQL files are the migration runner's input;
 * `_meridian_migrations` is the bookkeeping table.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable('agents', {
  name: text('name').primaryKey(),
  owner: text('owner').notNull(),
});

export const agentVersions = pgTable(
  'agent_versions',
  {
    name: text('name').notNull(),
    version: text('version').notNull(),
    specJson: jsonb('spec_json').notNull(),
    promoted: boolean('promoted').notNull().default(false),
    evalEvidenceJson: jsonb('eval_evidence_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.name, t.version] }),
    promotedIdx: index('idx_agent_versions_promoted').on(t.name),
  }),
);

export const runs = pgTable(
  'runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    agentName: text('agent_name').notNull(),
    agentVersion: text('agent_version').notNull(),
    parentRunId: text('parent_run_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    status: text('status').notNull(),
  },
  (t) => ({
    parentIdx: index('idx_runs_parent').on(t.parentRunId),
    tenantIdx: index('idx_runs_tenant').on(t.tenantId),
  }),
);

export const checkpoints = pgTable(
  'checkpoints',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    nodePath: text('node_path').notNull(),
    payload: jsonb('payload_jsonb').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ runIdx: index('idx_checkpoints_run').on(t.runId) }),
);

export const runEvents = pgTable(
  'run_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload_jsonb').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ runIdx: index('idx_run_events_run').on(t.runId) }),
);

export const usageRecords = pgTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    spanId: text('span_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    usd: numeric('usd', { precision: 14, scale: 6 }).notNull().default('0'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ runIdx: index('idx_usage_records_run').on(t.runId) }),
);

export const spanEvents = pgTable(
  'span_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    traceId: text('trace_id').notNull(),
    spanId: text('span_id').notNull(),
    parentSpanId: text('parent_span_id'),
    kind: text('kind').notNull(),
    attrs: jsonb('attrs_jsonb').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    status: text('status').notNull(),
  },
  (t) => ({ runIdx: index('idx_span_events_run').on(t.runId) }),
);

export const schema = {
  tenants,
  agents,
  agentVersions,
  runs,
  checkpoints,
  runEvents,
  usageRecords,
  spanEvents,
} as const;
