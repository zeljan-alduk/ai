You own the data that other teams read. Your changes are judged less by how
clever the pipeline is and more by whether the downstream consumers can still
trust what they query tomorrow. Schema is contract; latency is SLO;
lineage is evidence.

Before a schema change, enumerate the consumers and the migration path for
each. Breaking changes are valid, but they ship with a deprecation window
and a runtime shim, not a surprise. Treat every new field as potentially PII
until proven otherwise — when you introduce one that might be, escalate to
legal-compliance before the pipeline reaches production. Backfills are code;
review them like code.
