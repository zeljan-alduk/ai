"""
Pydantic v2 models mirroring the wire shapes in
``@aldo-ai/api-contract``.

Notes for maintainers:

* All models set ``ConfigDict(extra='ignore', populate_by_name=True)``
  so newer servers (which may add fields) don't break older clients,
  and so callers can construct via either snake_case Python names or
  the camelCase wire names.
* Field aliases match the Zod camelCase wire names. The Python
  attributes are snake_case for idiomatic use.
* LLM-agnostic by construction: ``provider`` / ``model`` / ``locality``
  are plain strings — the SDK never enumerates a specific provider.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Common
# ---------------------------------------------------------------------------

PrivacyTier = Literal["public", "internal", "sensitive"]
RunStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
SweepStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
Locality = Literal["cloud", "on-prem", "local"]


class _Base(BaseModel):
    """Project base — additive evolution + alias-friendly construction."""

    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        str_strip_whitespace=False,
    )


class PaginatedMeta(_Base):
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    has_more: bool = Field(default=False, alias="hasMore")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class AuthUser(_Base):
    id: str
    email: str
    created_at: str | None = Field(default=None, alias="createdAt")


class AuthTenant(_Base):
    id: str
    slug: str
    name: str
    role: str | None = None


class AuthMembership(_Base):
    tenant_id: str = Field(alias="tenantId")
    tenant_slug: str = Field(alias="tenantSlug")
    tenant_name: str = Field(alias="tenantName")
    role: str


class AuthSession(_Base):
    token: str
    user: AuthUser
    tenant: AuthTenant
    memberships: list[AuthMembership] = Field(default_factory=list)


class AuthMe(_Base):
    user: AuthUser
    tenant: AuthTenant
    memberships: list[AuthMembership] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


class Run(_Base):
    """Compact run record (matches ``RunSummary`` on the wire)."""

    id: str
    agent_name: str = Field(alias="agentName")
    agent_version: str = Field(alias="agentVersion")
    parent_run_id: str | None = Field(default=None, alias="parentRunId")
    status: RunStatus
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    duration_ms: int | None = Field(default=None, alias="durationMs")
    total_usd: float = Field(default=0.0, alias="totalUsd")
    last_provider: str | None = Field(default=None, alias="lastProvider")
    last_model: str | None = Field(default=None, alias="lastModel")
    has_children: bool | None = Field(default=None, alias="hasChildren")
    tags: list[str] | None = None
    archived_at: str | None = Field(default=None, alias="archivedAt")


class RunEvent(_Base):
    id: str
    type: str
    at: str
    payload: Any | None = None


class UsageRow(_Base):
    provider: str
    model: str
    tokens_in: int = Field(default=0, alias="tokensIn")
    tokens_out: int = Field(default=0, alias="tokensOut")
    usd: float = 0.0
    at: str


class RunDetail(Run):
    events: list[RunEvent] = Field(default_factory=list)
    usage: list[UsageRow] = Field(default_factory=list)


class RunTreeNode(_Base):
    run_id: str = Field(alias="runId")
    agent_name: str = Field(alias="agentName")
    agent_version: str = Field(alias="agentVersion")
    status: RunStatus
    parent_run_id: str | None = Field(default=None, alias="parentRunId")
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    duration_ms: int | None = Field(default=None, alias="durationMs")
    total_usd: float = Field(default=0.0, alias="totalUsd")
    last_provider: str | None = Field(default=None, alias="lastProvider")
    last_model: str | None = Field(default=None, alias="lastModel")
    class_used: str | None = Field(default=None, alias="classUsed")
    children: list["RunTreeNode"] = Field(default_factory=list)


RunTreeNode.model_rebuild()


class RunCompareDiff(_Base):
    event_count_diff: int = Field(alias="eventCountDiff")
    model_changed: bool = Field(alias="modelChanged")
    cost_diff: float = Field(alias="costDiff")
    duration_diff: int | None = Field(default=None, alias="durationDiff")
    same_agent: bool = Field(alias="sameAgent")


class RunCompareResponse(_Base):
    a: RunDetail
    b: RunDetail
    diff: RunCompareDiff


class ListRunsResponse(_Base):
    runs: list[Run] = Field(default_factory=list)
    meta: PaginatedMeta = Field(default_factory=PaginatedMeta)


class RunSearchResponse(_Base):
    runs: list[Run] = Field(default_factory=list)
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    total: int = 0


class BulkRunActionResponse(_Base):
    affected: int = 0


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------


class Agent(_Base):
    name: str
    owner: str
    latest_version: str = Field(alias="latestVersion")
    promoted: bool = False
    description: str = ""
    privacy_tier: PrivacyTier = Field(alias="privacyTier")
    team: str = ""
    tags: list[str] = Field(default_factory=list)


class AgentVersionEntry(_Base):
    version: str
    promoted: bool = False
    created_at: str = Field(alias="createdAt")


class AgentDetail(Agent):
    versions: list[AgentVersionEntry] = Field(default_factory=list)
    spec: Any | None = None
    guards: Any | None = None
    sandbox: Any | None = None
    composite: Any | None = None


class ListAgentsResponse(_Base):
    agents: list[Agent] = Field(default_factory=list)
    meta: PaginatedMeta = Field(default_factory=PaginatedMeta)


class RegisterAgentResult(_Base):
    name: str
    version: str
    promoted: bool = False


class RegisterAgentResponse(_Base):
    agent: RegisterAgentResult


class PromoteRegisteredAgentResponse(_Base):
    name: str
    current: str


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ModelCost(_Base):
    usd_per_mtok_in: float = Field(default=0.0, alias="usdPerMtokIn")
    usd_per_mtok_out: float = Field(default=0.0, alias="usdPerMtokOut")


class Model(_Base):
    id: str
    provider: str
    locality: str
    capability_class: str = Field(alias="capabilityClass")
    provides: list[str] = Field(default_factory=list)
    privacy_allowed: list[PrivacyTier] = Field(default_factory=list, alias="privacyAllowed")
    cost: ModelCost = Field(default_factory=ModelCost)
    latency_p95_ms: int | None = Field(default=None, alias="latencyP95Ms")
    effective_context_tokens: int = Field(default=0, alias="effectiveContextTokens")
    available: bool = False
    last_probed_at: str | None = Field(default=None, alias="lastProbedAt")


class ListModelsResponse(_Base):
    models: list[Model] = Field(default_factory=list)


class SavingsDailyPoint(_Base):
    date: str
    saved_usd: float = Field(default=0.0, alias="savedUsd")


class SavingsResponse(_Base):
    period: Literal["7d", "30d", "90d"]
    total_saved_usd: float = Field(default=0.0, alias="totalSavedUsd")
    local_run_count: int = Field(default=0, alias="localRunCount")
    unmatched_local_run_count: int = Field(default=0, alias="unmatchedLocalRunCount")
    daily_savings: list[SavingsDailyPoint] = Field(default_factory=list, alias="dailySavings")


# ---------------------------------------------------------------------------
# Eval / Sweeps / Datasets
# ---------------------------------------------------------------------------


class SweepCellResult(_Base):
    case_id: str = Field(alias="caseId")
    model: str
    passed: bool = False
    score: float = 0.0
    output: str = ""
    detail: Any | None = None
    cost_usd: float = Field(default=0.0, alias="costUsd")
    duration_ms: int = Field(default=0, alias="durationMs")


class Sweep(_Base):
    id: str
    suite_name: str = Field(alias="suiteName")
    suite_version: str = Field(alias="suiteVersion")
    agent_name: str = Field(alias="agentName")
    agent_version: str = Field(alias="agentVersion")
    models: list[str] = Field(default_factory=list)
    status: SweepStatus
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    by_model: dict[str, dict[str, float]] = Field(default_factory=dict, alias="byModel")
    cells: list[SweepCellResult] = Field(default_factory=list)


class SweepSummary(_Base):
    id: str
    suite_name: str = Field(alias="suiteName")
    suite_version: str = Field(alias="suiteVersion")
    agent_name: str = Field(alias="agentName")
    agent_version: str = Field(alias="agentVersion")
    status: SweepStatus
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    model_count: int = Field(default=0, alias="modelCount")
    case_count: int = Field(default=0, alias="caseCount")


class ListSuitesResponse(_Base):
    suites: list[dict[str, Any]] = Field(default_factory=list)


class ListSweepsResponse(_Base):
    sweeps: list[SweepSummary] = Field(default_factory=list)


class StartSweepResponse(_Base):
    sweep_id: str = Field(alias="sweepId")


class FailureClusterExample(_Base):
    case_id: str = Field(alias="caseId")
    model: str
    output: str


class FailureCluster(_Base):
    id: str
    sweep_id: str = Field(alias="sweepId")
    label: str
    count: int = 0
    examples_sample: list[FailureClusterExample] = Field(
        default_factory=list, alias="examplesSample"
    )
    top_terms: list[str] = Field(default_factory=list, alias="topTerms")
    sample_run_ids: list[str] = Field(default_factory=list, alias="sampleRunIds")
    created_at: str = Field(alias="createdAt")


class ClusterSweepResponse(_Base):
    clusters: list[FailureCluster] = Field(default_factory=list)
    failed_count: int = Field(default=0, alias="failedCount")


class DatasetSchemaColumn(_Base):
    name: str
    type: Literal["string", "number", "boolean", "object", "array"] = "string"
    description: str | None = None


class DatasetSchema(_Base):
    columns: list[DatasetSchemaColumn] = Field(default_factory=list)


class Dataset(_Base):
    id: str
    name: str
    description: str = ""
    schema_: DatasetSchema = Field(default_factory=DatasetSchema, alias="schema")
    tags: list[str] = Field(default_factory=list)
    example_count: int = Field(default=0, alias="exampleCount")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ListDatasetsResponse(_Base):
    datasets: list[Dataset] = Field(default_factory=list)


class DatasetExample(_Base):
    id: str
    dataset_id: str = Field(alias="datasetId")
    input: Any | None = None
    expected: Any | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    label: str | None = None
    split: str = "all"
    created_at: str = Field(alias="createdAt")


class ListDatasetExamplesResponse(_Base):
    examples: list[DatasetExample] = Field(default_factory=list)
    next_cursor: str | None = Field(default=None, alias="nextCursor")


class BulkCreateDatasetExamplesResponse(_Base):
    inserted: int = 0
    skipped: int = 0
    errors: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


class Notification(_Base):
    id: str
    user_id: str | None = Field(default=None, alias="userId")
    kind: str
    title: str
    body: str
    link: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    read_at: str | None = Field(default=None, alias="readAt")


class ListNotificationsResponse(_Base):
    notifications: list[Notification] = Field(default_factory=list)
    unread_count: int = Field(default=0, alias="unreadCount")


# ---------------------------------------------------------------------------
# Dashboards
# ---------------------------------------------------------------------------


class WidgetLayout(_Base):
    col: int
    row: int
    w: int
    h: int


class DashboardWidget(_Base):
    id: str
    kind: str
    title: str
    query: dict[str, Any] = Field(default_factory=dict)
    layout: WidgetLayout


class Dashboard(_Base):
    id: str
    name: str
    description: str = ""
    is_shared: bool = Field(default=False, alias="isShared")
    layout: list[DashboardWidget] = Field(default_factory=list)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    owned_by_me: bool = Field(default=False, alias="ownedByMe")


class ListDashboardsResponse(_Base):
    dashboards: list[Dashboard] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


class AlertThreshold(_Base):
    value: float
    comparator: Literal["gt", "gte", "lt", "lte"]
    period: Literal["5m", "1h", "24h", "7d"]


class AlertTargets(_Base):
    agent: str | None = None
    model: str | None = None
    locality: str | None = None


class AlertRule(_Base):
    id: str
    name: str
    kind: str
    threshold: AlertThreshold
    targets: AlertTargets = Field(default_factory=AlertTargets)
    notification_channels: list[str] = Field(default_factory=list, alias="notificationChannels")
    enabled: bool = True
    last_triggered_at: str | None = Field(default=None, alias="lastTriggeredAt")
    last_silenced_at: str | None = Field(default=None, alias="lastSilencedAt")
    created_at: str = Field(alias="createdAt")
    owned_by_me: bool = Field(default=False, alias="ownedByMe")


class ListAlertRulesResponse(_Base):
    rules: list[AlertRule] = Field(default_factory=list)


class TestAlertResponse(_Base):
    would_trigger: bool = Field(default=False, alias="wouldTrigger")
    value: float = 0.0
    threshold: AlertThreshold
    note: str | None = None


class SilenceAlertResponse(_Base):
    silenced_until: str = Field(alias="silencedUntil")


# ---------------------------------------------------------------------------
# Integrations
# ---------------------------------------------------------------------------


class Integration(_Base):
    id: str
    kind: Literal["slack", "github", "webhook", "discord"]
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    events: list[str] = Field(default_factory=list)
    enabled: bool = True
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    last_fired_at: str | None = Field(default=None, alias="lastFiredAt")


class ListIntegrationsResponse(_Base):
    integrations: list[Integration] = Field(default_factory=list)


class IntegrationResponse(_Base):
    integration: Integration


class TestFireResponse(_Base):
    ok: bool = False
    status_code: int | None = Field(default=None, alias="statusCode")
    error: str | None = None
    timed_out: bool | None = Field(default=None, alias="timedOut")


# ---------------------------------------------------------------------------
# Annotations + Shares
# ---------------------------------------------------------------------------


class AnnotationReactionSummary(_Base):
    kind: Literal["thumbs_up", "thumbs_down", "eyes", "check"]
    count: int = 0
    reacted_by_me: bool = Field(default=False, alias="reactedByMe")


class Annotation(_Base):
    id: str
    target_kind: Literal["run", "sweep", "agent"] = Field(alias="targetKind")
    target_id: str = Field(alias="targetId")
    parent_id: str | None = Field(default=None, alias="parentId")
    author_user_id: str = Field(alias="authorUserId")
    author_email: str = Field(alias="authorEmail")
    body: str
    reactions: list[AnnotationReactionSummary] = Field(default_factory=list)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ListAnnotationsResponse(_Base):
    annotations: list[Annotation] = Field(default_factory=list)


class ShareLink(_Base):
    id: str
    target_kind: Literal["run", "sweep", "agent"] = Field(alias="targetKind")
    target_id: str = Field(alias="targetId")
    slug: str
    url: str
    has_password: bool = Field(default=False, alias="hasPassword")
    expires_at: str | None = Field(default=None, alias="expiresAt")
    revoked_at: str | None = Field(default=None, alias="revokedAt")
    view_count: int = Field(default=0, alias="viewCount")
    created_at: str = Field(alias="createdAt")
    created_by_user_id: str = Field(alias="createdByUserId")
    created_by_email: str = Field(alias="createdByEmail")


class ListShareLinksResponse(_Base):
    shares: list[ShareLink] = Field(default_factory=list)


class CreateShareLinkResponse(_Base):
    share: ShareLink


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------


class SecretSummary(_Base):
    name: str
    fingerprint: str
    preview: str
    referenced_by: list[str] = Field(default_factory=list, alias="referencedBy")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ListSecretsResponse(_Base):
    secrets: list[SecretSummary] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------


class Subscription(_Base):
    plan: Literal["trial", "solo", "team", "enterprise", "cancelled"]
    status: Literal[
        "trialing", "active", "past_due", "cancelled", "unpaid", "incomplete"
    ]
    trial_end: str | None = Field(default=None, alias="trialEnd")
    current_period_end: str | None = Field(default=None, alias="currentPeriodEnd")
    cancelled_at: str | None = Field(default=None, alias="cancelledAt")
    trial_days_remaining: int | None = Field(default=None, alias="trialDaysRemaining")


# ---------------------------------------------------------------------------
# Playground
# ---------------------------------------------------------------------------


class PlaygroundFrame(_Base):
    """One SSE frame from ``POST /v1/playground/run``.

    The ``model_id`` field tags every frame with the resolved model the
    server picked for that column — the SDK never enumerates a
    provider; the gateway does.
    """

    model_id: str = Field(alias="modelId")
    type: Literal["start", "delta", "usage", "error", "done"]
    payload: Any | None = None


__all__ = [
    "Agent",
    "AgentDetail",
    "AgentVersionEntry",
    "AlertRule",
    "AlertTargets",
    "AlertThreshold",
    "Annotation",
    "AnnotationReactionSummary",
    "AuthMe",
    "AuthMembership",
    "AuthSession",
    "AuthTenant",
    "AuthUser",
    "BulkCreateDatasetExamplesResponse",
    "BulkRunActionResponse",
    "ClusterSweepResponse",
    "CreateShareLinkResponse",
    "Dashboard",
    "DashboardWidget",
    "Dataset",
    "DatasetExample",
    "DatasetSchema",
    "DatasetSchemaColumn",
    "FailureCluster",
    "FailureClusterExample",
    "Integration",
    "IntegrationResponse",
    "ListAgentsResponse",
    "ListAlertRulesResponse",
    "ListAnnotationsResponse",
    "ListDashboardsResponse",
    "ListDatasetExamplesResponse",
    "ListDatasetsResponse",
    "ListIntegrationsResponse",
    "ListModelsResponse",
    "ListNotificationsResponse",
    "ListRunsResponse",
    "ListSecretsResponse",
    "ListShareLinksResponse",
    "ListSuitesResponse",
    "ListSweepsResponse",
    "Locality",
    "Model",
    "ModelCost",
    "Notification",
    "PaginatedMeta",
    "PlaygroundFrame",
    "PrivacyTier",
    "PromoteRegisteredAgentResponse",
    "RegisterAgentResponse",
    "Run",
    "RunCompareDiff",
    "RunCompareResponse",
    "RunDetail",
    "RunEvent",
    "RunSearchResponse",
    "RunStatus",
    "RunTreeNode",
    "SavingsDailyPoint",
    "SavingsResponse",
    "SecretSummary",
    "ShareLink",
    "SilenceAlertResponse",
    "StartSweepResponse",
    "Subscription",
    "Sweep",
    "SweepCellResult",
    "SweepStatus",
    "SweepSummary",
    "TestAlertResponse",
    "TestFireResponse",
    "UsageRow",
    "WidgetLayout",
]
