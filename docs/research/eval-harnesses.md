# Eval Harnesses — Research & Recommendation

*eval-researcher, ALDO TECH LABS — 2026-04-24*

Eval is a promotion gate. Every agent-spec change must pass a cross-provider suite before the registry promotes it. Users need hard numbers to answer "can I downgrade this sub-agent to Qwen?" Sensitive-tier suites must execute against local models only.

---

## 1. Eval kinds we must support

| Kind | Purpose |
|------|---------|
| **Unit prompt tests** | `assert contains/regex/equals`; cheap smoke |
| **Schema validation** | JSON-schema / Pydantic conformance of structured output |
| **Rubric / LLM-as-judge** | semantic grading; self-consistency (N samples) and pairwise (A/B) |
| **Golden regressions** | fixed inputs → known-good outputs, diffed per run |
| **Trajectory evals** | right tools, right order, sane args |
| **E2E task success** | agent completes task against stubbed env (fs, shell, HTTP) |
| **Adversarial / red-team** | prompt injection, exfiltration, jailbreak, tool-abuse |
| **Cost/latency SLO** | p50/p95 latency, tokens, $/call — the "downgrade?" gate |

A promotion gate runs the union; individual changes can run the relevant subset.

---

## 2. Harness comparison

| Harness | Test model | LLM-as-judge | Datasets | CI | Cross-provider | Self-host | OSS |
|---|---|---|---|---|---|---|---|
| **OpenAI Evals** | registry of YAML/JSONL benchmarks; `Completion Function Protocol` for agents | yes (ModelGraded) | JSONL in-repo | CLI, fine with GH Actions | via completion functions, but OpenAI-centric defaults | yes | MIT |
| **Anthropic Console Evals** | console test sets with `{{var}}` prompts, CSV, 5-pt grading; Skill-creator parallel executor+grader sub-agents (Mar 2026) | yes (Claude-graded) | console + CSV | limited; console-first | Claude-only | no (SaaS) | no |
| **promptfoo** (OpenAI-maintained, Mar 2026) | YAML matrices; 90+ providers incl. Ollama; coding-agent evaluators for Claude Agent SDK, Codex, OpenCode | yes (`llm-rubric`, pairwise, factuality) | CSV/JSON/HF | first-class (GH Action, PR comment) | **best-in-class** | yes, local | MIT |
| **DeepEval** (Confident AI) | pytest-style; 50+ research-backed metrics, G-Eval, PlanQuality, PlanAdherence, tool-selection | yes | pytest fixtures / Confident AI cloud | pytest → CI trivial | any via LiteLLM | OSS local; Confident AI SaaS | Apache-2 |
| **Inspect** (UK AISI) | Python tasks; ReAct, multi-agent primitives, external agent bridge (Claude Code / Codex / Gemini CLI / AutoGen); rich trajectory logs | yes | Python; Inspect-Evals registry | CLI + logs viewer | provider-agnostic | yes | MIT |
| **Langfuse evals** | tracing-first, scorable manually or via LLM-judge; datasets + prompt mgmt | yes | Langfuse datasets | SDK → CI | any (via SDK) | **yes, fully self-hostable** | MIT |
| **Braintrust** | eval-driven development; CI merge-blocking with statistical significance | yes | managed datasets | strong (auto block merges) | any | SaaS (enterprise self-host) | source-available |
| **LangSmith** | tracing + eval; trajectory evaluators `strict/unordered/subset/superset` | yes | LangSmith datasets | SDK | any, but LangChain-leaning (vendor lock-in risk) | SaaS (enterprise self-host) | proprietary |
| **Ragas** | RAG-centric metrics (faithfulness, context recall/precision) | yes | Python | pytest | any | yes | Apache-2 |
| **Arize Phoenix** | observability + trajectory evals; embedding projections; OpenInference traces | yes | Phoenix | SDK | any | yes | Elastic-2 |
| **HELM** (Stanford) | academic leaderboard; breadth of scenarios; not app-eval | n/a | fixed scenarios | no | model-agnostic | yes | Apache-2 |
| **lm-eval-harness** (EleutherAI) | 60+ standard benchmarks (MMLU, HellaSwag, BBH) for base-model capability | no | built-in | no | HF/OpenAI/etc. | yes | MIT |

**Takeaway.** HELM and lm-eval-harness answer "how smart is this base model" — useful when onboarding a new candidate (Qwen3, Llama-4) but not for agent-spec CI. promptfoo + Inspect are the two credible foundations for our use case; DeepEval is the strongest pytest-native option; Langfuse is the strongest OSS result store.

---

## 3. ALDO AI eval model

**Eval spec.** Every agent ships a sibling `evals/*.yaml` alongside `agent.yaml`. Fields:

- `suite`: id, tier (smoke | full | adversarial | slo)
- `dataset`: ref to `datasets/<name>@<semver>`
- `cases[]`: input, expected (assertions, schema, rubric id, trajectory pattern, task-env ref)
- `judge`: model ref (defaults to org policy), `self_consistency: N`, `pairwise: bool`
- `thresholds`: pass rate, rubric score, p95 latency, $/call
- `required_for_promotion`: bool

**Datasets as artifacts.** `datasets/` is a first-class registry, versioned `dataset/<name>@<semver>`. Breaking changes bump major; new cases bump minor; relabelling bumps patch. Agents pin a dataset version; the gate warns on stale pins.

**Judge-model selection.** Judges are LLM-agnostic, resolved through the same provider abstraction as any other agent. Default policy: `judge: strong-reasoner` alias → configurable per org (e.g. `claude-opus-4-7`, `gpt-5.1`, or local `qwen3-72b-instruct` for sensitive tier). Judge must never be the candidate model (self-preference bias). Pairwise runs bias-swap positions.

**Cross-model sweep.** `aldo eval sweep agent/code-reviewer --models claude-sonnet-4.5,gpt-5.1-mini,qwen2.5-coder:32b,llama-4-70b` runs the suite against each, emits a comparison report: pass rate, rubric mean, p95 latency, $/case, Δ-vs-current-baseline. Answers the downgrade question directly.

**Promotion gate.** `aldo promote agent/code-reviewer@1.5.0` resolves `required_for_promotion: true` suites, runs them against the new spec, blocks on any failure or threshold miss. Gate writes a signed `promotion-report.json` into the registry; rollback restores prior spec + report.

**Privacy tier.** Suites declare `tier: sensitive`. The eval runner refuses remote providers for sensitive suites and routes judge calls to local models only.

**Result storage.** Runs emit OpenInference traces to our trace backend (see observability ADR); eval results reference `trace_id` per case so a failing rubric score links straight to the span tree.

---

## 4. Agent-trajectory evals

Agents are paths, not points. We capture trajectory at three layers:

1. **Structured tool-call log** per run: ordered list of `{tool, args, result_digest, latency_ms, tokens}`, emitted through the standard trace exporter.
2. **Assertion DSL** (borrowed from LangSmith/openevals/Vertex):
   - `match_mode: strict | unordered | subset | superset`
   - `tool_args_match: exact | schema | semantic` (last uses LLM-judge on args)
   - forbidden-tool lists (e.g. `shell.rm_rf` must never appear)
   - regex-on-args (e.g. `http.fetch` URL must match allow-list)
3. **Path quality metrics**: trajectory-precision, trajectory-recall, exact-match, plus DeepEval's PlanQuality / PlanAdherence for open-ended agents where no ideal path exists.

Golden trajectories are stored in the dataset artifact alongside inputs. Diff viewer in the CLI renders actual-vs-expected as a merge-style sequence diff.

---

## 5. Adversarial eval corpus

Standing red-team suite, run nightly and on promotion for any agent with tool access or external I/O. Initial sources:

- **Garak** (NVIDIA) — prewritten probes for jailbreaks, prompt injection, data leakage, toxicity; easy import as a case generator.
- **PyRIT** (Microsoft) — programmatic attack chaining; good for multi-turn escalation and scenario authoring.
- **promptfoo red-team** — 67+ plugins, OWASP LLM Top-10 coverage; native to our harness choice.
- **DeepTeam** (Nov 2025) — jailbreak + injection pipelines.
- **Public datasets**: Gandalf prompts, TensorTrust injection corpus, AdvBench, HarmBench, UK AISI/Gray Swan challenge set.
- **ALDO AI-authored suite**: exfiltration via tool args, privilege-escalation via sub-agent spawn, cross-agent context poisoning (tier-bridging), secrets-egress probes.

Corpus is a versioned dataset like any other (`dataset/redteam-core@2.3.0`), refreshed quarterly.

---

## 6. Developer loop

```
$ aldo eval run agent/code-reviewer --model qwen2.5-coder:32b

Resolving agent/code-reviewer@1.5.0-dev  ok
Dataset dataset/code-review-golden@3.1.0 (142 cases)
Suites: smoke(142) rubric(40) trajectory(30) slo(20)
Judge:  local/qwen3-72b-instruct  (sensitive tier)

[smoke]       142/142 pass
[rubric]       37/40  pass   mean 4.2/5  (baseline 4.4, Δ -0.2)
[trajectory]   28/30  pass   2 unexpected shell.find calls
[slo]          20/20  pass   p95 3.8s (budget 5.0s)  $0.004/case

RESULT: FAIL (rubric below baseline threshold 4.3)
Diff vs agent/code-reviewer@1.4.0 (claude-sonnet-4.5): report://runs/7f2a...
```

Exit codes are CI-friendly. `--baseline` defaults to the currently-promoted version of the same agent, enabling regression gating. `--sweep <models>` runs matrix mode. `--record-golden` updates dataset cases under human review.

---

## 7. Recommendation

**Adopt Inspect (UK AISI) as the harness foundation** — OSS, Python-native, provider-agnostic, first-class trajectory support, already bridges external agents (Claude Code / Codex / Gemini CLI) which matches ALDO AI's sub-agent model. **Wrap with promptfoo** for YAML-declarative prompt matrices and its red-team plugins. **Adversarial corpus = Garak + PyRIT + promptfoo red-team + ALDO AI-authored**. **Store results and traces in self-hosted Langfuse** (MIT, datasets + scores + traces in one place) so sensitive-tier runs never leave our infra. Skip LangSmith/Braintrust as foundations (lock-in, SaaS-first); watch-list Braintrust for merge-blocking analytics. Vendor DeepEval metrics (PlanQuality, PlanAdherence) where Inspect lacks.

---

## 8. Open questions

1. **Judge drift.** How often do we re-baseline rubric scores when the default judge model is upgraded? Do we pin judge-model version per dataset version?
2. **Flaky LLM-judge variance.** Self-consistency N=? Do we require confidence intervals on rubric means for promotion, or a fixed Δ-threshold?
3. **Golden-trajectory authorship.** Human-authored, model-authored-human-reviewed, or synthesized from production traces with redaction? All three have failure modes.
4. **Sensitive-tier judge quality.** Do local judges (Qwen3-72B, Llama-4) clear our rubric reliability bar vs. frontier judges? If not, is there a trusted-enclave path for sensitive eval?
5. **Cost of full sweep.** Running every adversarial + trajectory suite against every candidate on every promotion could be $$$. Sampling strategy? Tiered gates (smoke on every commit, full on release)?
6. **Task-env stubs.** Who maintains the stubbed filesystem/shell/HTTP environments for E2E task success? Shared fixture registry or per-agent?
