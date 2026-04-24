# Memory Systems for Meridian

## 1. Survey

**Letta (formerly MemGPT).** OS-style memory manager: a model-driven loop that
pages "core memory" (always in context), "archival memory" (vector store), and
"recall memory" (chat history) through tool calls. Strong agent self-editing
of memory blocks; opinionated runtime; useful patterns to steal even if we
don't adopt the runtime.

**Mem0.** Memory-as-a-service with an "extract → consolidate → retrieve"
pipeline that turns chat turns into structured facts plus embeddings.
Pluggable vector store and LLM. Good developer ergonomics; the consolidation
step is the interesting bit. Hosted SaaS plus OSS core.

**Zep.** Temporal knowledge-graph memory built on a graph + vector hybrid
("Graphiti"). Tracks entity/fact validity over time, which matters for
"what did the SRE think yesterday vs. today." Heavier infra footprint but
the temporal model is the closest match to our run-tree semantics.

**LangChain memory.** A grab bag: buffer, summary buffer, entity, KG, vector
retriever memory. Mostly thin wrappers; tightly coupled to LangChain
runnables. Useful as a reference for the buffer/summary/window patterns,
not as a dependency.

**LlamaIndex memory.** `ChatMemoryBuffer`, `VectorMemory`, composable memory
blocks; integrates with their ingestion/indexing stack. Stronger on the
RAG-shaped retrieval side than on agent-loop memory editing.

**Cognee.** ECL (extract-cognify-load) pipeline producing a knowledge graph
plus vectors; emphasises ontology-driven structuring of memory. Promising
for the "org" tier where we want stable entities (services, ADRs, people).

**Roll-your-own.** pgvector (cheapest path, lives next to relational data,
HNSW + IVF, hybrid search via tsvector); Qdrant (best filtering DSL, Rust,
payload indices); Weaviate (modules, hybrid BM25+vector built-in); Chroma
(dev ergonomics, weak at scale); LanceDB (embedded, columnar, great for
local/edge agents); Turbopuffer (cheap object-storage-backed, excellent for
cold/archival tiers, slower p99). For Meridian, pgvector + Turbopuffer
covers hot and cold without a second service in v0.1.

## 2. Scope model

Four scopes, each with explicit ACLs and retention:

- **private** — per-agent scratch. TTL default 24h, configurable per agent
  spec. No cross-agent reads. GDPR: drop with the run.
- **session** — per-end-user. Survives across runs that share a `user_id`.
  Read/write only by agents invoked on behalf of that user. Right-to-erasure
  honoured by `user_id` purge.
- **project / blackboard** — scoped to a run-tree (root run + children).
  Read by any agent in the tree; write gated by capability
  (`memory.blackboard.write`). Retained for the project's lifetime.
- **org** — durable, shared across run-trees. Write requires reviewer
  approval or an explicit `memory.org.write` capability and is logged.
  Retention indefinite; deletion via tombstone + re-index.

Authorization is enforced in the memory gateway, not in agent code, and
rides on the same capability tokens used by the model gateway. Privacy
tier propagates: a `sensitive` agent cannot read from an `internal`-tier
store unless the store is also `sensitive`-or-stricter.

## 3. Retrieval recipes

- **architect — ADR archive.** Hybrid search over `org/adr/*`: BM25 on
  title + status, vector on body, filter by `status in {accepted, proposed}`.
  Rerank with a small cross-encoder. Always include the latest 3 ADRs that
  touch the same component, regardless of score.
- **code-reviewer — project conventions.** Project scope. Pull `style/*`,
  `lint-rationale/*`, and the diff's file globs' nearest `CONVENTIONS.md`.
  Deterministic top-k by path proximity beats semantic search here.
- **historian — run summaries.** Time-ordered fetch from `org/run-summary/*`
  filtered by tag/agent/date window; summarise-on-read when the window
  exceeds the budget. Zep-style temporal validity is the right long-term
  model.
- **sre — last-24h time-series.** Not a vector problem. Direct query against
  the metrics/log store (Loki/Prom/ClickHouse) via MCP tool, with vector
  retrieval reserved for postmortems and runbooks.

## 4. Embeddings strategy

Default cloud: a small, cheap, multilingual model (e.g. `text-embedding-3-small`
class) for `internal` and `public` tiers. Local options for `sensitive` and
air-gapped: BGE-M3, E5-mistral, Snowflake Arctic-Embed, Nomic-Embed,
gte-large. The embedding gateway mirrors the model gateway: agents request
a *capability* (`embed.text.multilingual.long`) and the router picks based
on privacy tier and availability.

Indices are versioned: `meridian_embeddings_v{model_id}_{dim}`. Switching
models writes a new index in the background; reads dual-fetch during
migration; old index dropped after a configurable soak. Re-embedding cost
is bounded by tier — `private` is never re-embedded, `org` always is.

## 5. Context engineering

Per-call token budget is split by section with hard caps:

- system + agent spec: 10%
- tool schemas: 15%
- retrieved memory: 35%
- conversation tail: 30%
- scratch / planning: 10%

When the conversation tail exceeds its cap, run a compression pass:
extract decisions, open questions, and tool-call outcomes into a
structured summary; drop raw turns older than the last decision boundary.
Summaries are themselves embedded into session scope so nothing is lost,
just demoted. Budgets are model-aware (200k vs. 8k context windows differ
in absolute size, not ratios).

## 6. Blackboard API (project scope)

Keyspace: `project/{run_root_id}/{namespace}/{key}`. Values are JSON with a
monotonically increasing `version` and a `writer_run_id`. Operations:
`get`, `put(expected_version)`, `cas`, `list(prefix)`, `subscribe(prefix)`.
Pub/sub via Postgres `LISTEN/NOTIFY` in v0.1, swappable for NATS later.
Conflicts surface as `VersionConflict` errors; agents either retry with a
merge function or escalate to the principal. All writes are append-only
under the hood (event log + materialised view) so replay reconstructs the
blackboard at any point in the run.

## 7. v0.1 stack

Single Neon Postgres with pgvector for `private`, `session`, and `project`
scopes; same DB hosts the run/event log so replay and memory share a
transaction boundary. `org` scope starts in pgvector too, with Turbopuffer
earmarked for archival once volume warrants. Embeddings via the gateway,
defaulting to a cloud small-embedding model with BGE-M3 available locally
for `sensitive`. Blackboard is a `blackboard_entries` table plus
`LISTEN/NOTIFY`. No new infra to operate. Migrate hot paths to Qdrant or
Zep only when measurements demand it.

## 8. Open questions

1. Do we expose memory edits as MCP tools (Letta-style) or as a typed SDK
   that agents call directly? MCP is more uniform; the SDK is faster.
2. How do we represent temporal validity (Zep's killer feature) on top of
   pgvector without re-implementing Graphiti?
3. What's the canonical schema for a "fact" in org memory — free text,
   triple, or typed event? Affects how the historian and architect query.
4. Re-embedding policy for `session` scope on user request vs. on model
   upgrade — who pays the latency?
5. Is the blackboard a separate abstraction from session/org memory, or
   just a scope with a stricter API? Leaning "just a scope."
6. Do we need a cross-encoder reranker in v0.1, or is hybrid BM25+vector
   sufficient until eval says otherwise?

Status: proposed
