"""
Pull a dataset, kick off an eval sweep, poll until done, print results.

Run with::

    ALDO_TOKEN=... DATASET_ID=ds_abc SUITE=demo \
        MODELS=p1.m1,p2.m2 python examples/eval_runner.py
"""

from __future__ import annotations

import os
import sys
import time

from aldo_ai import AldoClient
from aldo_ai.errors import AldoAPIError


def main() -> int:
    api_base = os.environ.get("ALDO_API_BASE", "https://ai.aldo.tech")
    token = os.environ.get("ALDO_TOKEN")
    suite = os.environ.get("SUITE", "demo")
    dataset_id = os.environ.get("DATASET_ID")
    models_csv = os.environ.get("MODELS", "")

    if not token:
        print("Set ALDO_TOKEN.")
        return 1
    if not models_csv:
        print("Set MODELS to a comma-separated list of `provider.model` ids.")
        return 1
    models = [m.strip() for m in models_csv.split(",") if m.strip()]

    with AldoClient(api_base=api_base, token=token) as client:
        if dataset_id:
            try:
                ds = client.datasets.get(dataset_id)
                print(f"using dataset {ds.name} ({ds.example_count} examples)")
                page = client.datasets.get_examples(dataset_id, limit=3)
                for ex in page.examples:
                    print(f"  - {ex.id}: input={ex.input!r:.80}")
            except AldoAPIError as exc:
                print(f"warning: failed to load dataset {dataset_id}: {exc}")

        print(f"\nstarting sweep: suite={suite} models={models}")
        sweep = client.eval.run_sweep(suite_name=suite, models=models)
        print(f"  sweepId={sweep.sweep_id}")

        # poll
        while True:
            current = client.eval.get_sweep(sweep.sweep_id)
            print(f"  status={current.status}  cells={len(current.cells)}")
            if current.status in {"completed", "failed", "cancelled"}:
                break
            time.sleep(5)

        print("\n=== per-model summary ===")
        for model, stats in current.by_model.items():
            print(
                f"  {model:<32} pass={stats.get('passed', 0)}/"
                f"{stats.get('total', 0)} usd=${stats.get('usd', 0.0):.4f}"
            )

        if current.status != "completed":
            return 2

        try:
            clusters = client.eval.cluster_failures(sweep.sweep_id)
            print(
                f"\n=== failure clusters ({clusters.failed_count} failed cells) ==="
            )
            for c in clusters.clusters:
                terms = ", ".join(c.top_terms[:5]) or "(no terms)"
                print(f"  - {c.label} ({c.count}× | {terms})")
        except AldoAPIError as exc:
            print(f"warning: cluster_failures failed: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
