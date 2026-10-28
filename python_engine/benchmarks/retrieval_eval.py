"""Reproducible evaluation of the BM25 retriever.

WHAT THIS MEASURES
------------------
This suite measures the **retriever**, not a model. No model adapter is
constructed, no generation happens, and no oracle replies are used. Every
number below comes from ``PersistentIndex.search`` alone. A model score would
be a different measurement and is reported elsewhere (``benchmarks/runner.py``).

WHY IT EXISTS
-------------
The agentic eval suite has a known weakness: the ``research`` tasks put the
answer in the prompt, so a trivial echo adapter scores 5/5 on them. That
measures extraction, not retrieval. This suite closes the gap by requiring the
index to find information that is *not* in the query.

WHAT IS SCORED
--------------
* ``precision@k`` - of the k results returned, how many are relevant.
* ``recall@k``    - of the relevant documents, how many were found in the top k.
* ``MRR``         - 1 / rank of the first relevant result (0 if none).
* ``negative-control accuracy`` - fraction of unanswerable queries that
  correctly returned nothing relevant.

Negative controls are the honesty check. A retriever that always returns
something scores 100% recall and 0% on negative controls; only a retriever that
can say "nothing here" is usable in an agent, because a confident wrong passage
is worse than an empty result.

DIFFICULTY IS DELIBERATE
------------------------
The corpus includes paraphrases, synonyms, multi-hop questions, distractors
with high lexical overlap, contradictory documents and unanswerable queries.
Some of these are expected to FAIL with a lexical retriever and no stemming.
Those failures are recorded, not tuned away: editing the corpus until it passes
would make the number meaningless.

Run:  python benchmarks/retrieval_eval.py [--k 3] [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rare_engine.memory.index import PersistentIndex  # noqa: E402

# --------------------------------------------------------------------------
# Corpus
# --------------------------------------------------------------------------
# Each entry: (doc_id, namespace, text). Sources are unique so re-ingestion
# replaces rather than duplicates.

CORPUS: list[tuple[str, str, str]] = [
    (
        "doc_deploy",
        "default",
        "The deployment pipeline runs on Kubernetes. Rollbacks are triggered "
        "automatically when the error rate exceeds two percent over five minutes.",
    ),
    (
        "doc_deploy_legacy",
        "default",
        "The deployment pipeline runs on bare metal servers. Rollbacks are "
        "performed manually by the on-call engineer.",
    ),
    (
        "doc_ratelimit",
        "default",
        "API rate limits are 1000 requests per minute per tenant. Exceeding the "
        "limit returns HTTP 429.",
    ),
    (
        "doc_ratelimit_distractor",
        "default",
        "The marketing site has a rate card listing 1000 impressions per minute "
        "for the homepage banner.",
    ),
    (
        "doc_auth",
        "default",
        "Authentication uses short-lived JWT access tokens with a fifteen minute "
        "expiry, refreshed by a rotating refresh token.",
    ),
    (
        "doc_storage",
        "default",
        "Object storage is S3-compatible and encrypted at rest with AES-256.",
    ),
    (
        "doc_oncall",
        "default",
        "The on-call rotation is weekly and hands over on Monday at 09:00 UTC.",
    ),
    (
        "doc_budget",
        "default",
        "The quarterly infrastructure budget is 42000 dollars, approved by "
        "finance in March.",
    ),
    (
        "doc_incident",
        "default",
        "Incident INC-4471 was caused by a connection pool exhaustion in the "
        "payments service.",
    ),
    (
        "doc_incident_fix",
        "default",
        "The remediation for INC-4471 was to raise the pool size to 50 and add a "
        "saturation alert.",
    ),
    (
        "doc_latency",
        "default",
        "Latency budgets for the checkout path are 300 milliseconds at p99.",
    ),
    (
        "doc_schema",
        "default",
        "Engineers must obtain approval before modifying production database "
        "schemas.",
    ),
    (
        "doc_tenant_a",
        "tenant_a",
        "Tenant A secret rotation interval is 30 days.",
    ),
    (
        "doc_tenant_b",
        "tenant_b",
        "Tenant B secret rotation interval is 90 days.",
    ),
]


@dataclass
class Case:
    """One retrieval question with its ground truth."""

    id: str
    category: str
    query: str
    relevant: set[str] = field(default_factory=set)
    namespace: str | None = None
    note: str = ""

    @property
    def is_negative(self) -> bool:
        return not self.relevant


CASES: list[Case] = [
    # --- direct lexical match: the easy baseline -------------------------
    Case(
        "direct_ratelimit",
        "direct",
        "API rate limit per minute",
        {"doc_ratelimit"},
        note="exact vocabulary overlap; must pass",
    ),
    Case(
        "direct_storage",
        "direct",
        "object storage encryption at rest",
        {"doc_storage"},
    ),
    Case(
        "direct_oncall",
        "direct",
        "on-call rotation handover",
        {"doc_oncall"},
    ),
    # --- paraphrase: same meaning, different words -----------------------
    Case(
        "para_token_expiry",
        "paraphrase",
        "how quickly do access tokens expire",
        {"doc_auth"},
        note="predicted to fail; PASSED - 'access token' carries the match",
    ),
    Case(
        "para_rollback",
        "paraphrase",
        "what happens when errors spike during a release",
        {"doc_deploy"},
        note="predicted to fail; PASSED - 'release'/'deployment' overlap was enough",
    ),
    Case(
        "para_budget",
        "paraphrase",
        "how much money is allocated to infrastructure each quarter",
        {"doc_budget"},
        note="predicted to fail; PASSED - 'infrastructure'/'quarter' carried it",
    ),
    # --- synonym: near-synonyms that a stemmer would not fix -------------
    Case(
        "syn_latency",
        "synonym",
        "p99 latency target for checkout",
        {"doc_latency"},
        note="shares 'latency', 'checkout', 'p99' - should pass",
    ),
    Case(
        "syn_approval",
        "synonym",
        "who must approve production database schema changes",
        {"doc_schema"},
        note="'changes' vs 'modifying' - partial overlap only",
    ),
    # --- multi-hop: needs two documents ----------------------------------
    Case(
        "hop_incident",
        "multi_hop",
        "what caused INC-4471 and how was it fixed",
        {"doc_incident", "doc_incident_fix"},
        note="both documents must appear in top-k",
    ),
    # --- distractor: high lexical overlap, wrong answer ------------------
    Case(
        "dist_ratelimit",
        "distractor",
        "what is the API rate limit per minute",
        {"doc_ratelimit"},
        note="doc_ratelimit_distractor shares rate/1000/per/minute",
    ),
    # --- contradiction: both sides must surface --------------------------
    Case(
        "contra_deploy",
        "contradiction",
        "what does the deployment pipeline run on",
        {"doc_deploy", "doc_deploy_legacy"},
        note="corpus contradicts itself; both must be retrievable",
    ),
    # --- negative controls: the answer is NOT in the corpus --------------
    Case(
        "neg_mongolia",
        "negative",
        "what is the capital of Mongolia",
        note="no shared vocabulary at all",
    ),
    Case(
        "neg_vacation",
        "negative",
        "how many vacation days do employees get",
        note="'days' appears in tenant docs - adversarial",
    ),
    Case(
        "neg_ceo_salary",
        "negative",
        "what is the chief executive salary",
        note="'salary' absent; 'executive' absent",
    ),
    Case(
        "neg_billing_db",
        "negative",
        "which database engine does the billing service use",
        note="'database' and 'service' both appear elsewhere - adversarial",
    ),
    # --- isolation: namespaces must not leak -----------------------------
    Case(
        "iso_tenant_a",
        "isolation",
        "secret rotation interval",
        {"doc_tenant_a"},
        namespace="tenant_a",
        note="must not return tenant_b",
    ),
    Case(
        "iso_tenant_b",
        "isolation",
        "secret rotation interval",
        {"doc_tenant_b"},
        namespace="tenant_b",
        note="must not return tenant_a",
    ),
]


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------


@dataclass
class CaseResult:
    case: Case
    retrieved: list[str]
    precision: float
    recall: float
    reciprocal_rank: float
    passed: bool
    detail: str = ""


def score_case(case: Case, retrieved: list[str], k: int) -> CaseResult:
    """Score one case. Negative controls are scored as pass/fail only."""
    top = retrieved[:k]

    if case.is_negative:
        # A negative control passes when nothing relevant came back. Since
        # there is no relevant set, "relevant" means "any hit at all" - a
        # retriever that returns a passage for an unanswerable question is
        # exactly the failure this control exists to catch.
        passed = len(top) == 0
        return CaseResult(
            case=case,
            retrieved=top,
            precision=1.0 if passed else 0.0,
            recall=1.0 if passed else 0.0,
            reciprocal_rank=1.0 if passed else 0.0,
            passed=passed,
            detail="returned nothing" if passed else f"returned {len(top)} hit(s)",
        )

    hits = [doc_id for doc_id in top if doc_id in case.relevant]
    precision = len(hits) / k if k else 0.0
    recall = len(hits) / len(case.relevant) if case.relevant else 0.0

    rr = 0.0
    for position, doc_id in enumerate(top, start=1):
        if doc_id in case.relevant:
            rr = 1.0 / position
            break

    return CaseResult(
        case=case,
        retrieved=top,
        precision=precision,
        recall=recall,
        reciprocal_rank=rr,
        passed=recall == 1.0,
        detail=f"found {len(hits)}/{len(case.relevant)}",
    )


def build_index(root: Path) -> PersistentIndex:
    index = PersistentIndex(root)
    for doc_id, namespace, text in CORPUS:
        index.add_document(
            text,
            source=f"{doc_id}.md",
            title=doc_id,
            doc_id=doc_id,
            namespace=namespace,
        )
    index.save()
    return index


def run(k: int = 3) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        index = build_index(Path(tmp))
        results: list[CaseResult] = []
        for case in CASES:
            hits = index.search(case.query, top_k=k, namespace=case.namespace)
            retrieved = [hit.doc_id for hit in hits]
            results.append(score_case(case, retrieved, k))

    # Aggregate. Negative controls are excluded from precision/recall/MRR
    # because those metrics are undefined without a relevant set; they get
    # their own accuracy figure.
    positives = [r for r in results if not r.case.is_negative]
    negatives = [r for r in results if r.case.is_negative]

    def mean(values: list[float]) -> float:
        return sum(values) / len(values) if values else 0.0

    by_category: dict[str, dict] = {}
    for category in sorted({r.case.category for r in results}):
        group = [r for r in results if r.case.category == category]
        pos = [r for r in group if not r.case.is_negative]
        by_category[category] = {
            "cases": len(group),
            "passed": sum(1 for r in group if r.passed),
            "precision@k": round(mean([r.precision for r in pos]), 4) if pos else None,
            "recall@k": round(mean([r.recall for r in pos]), 4) if pos else None,
            "mrr": round(mean([r.reciprocal_rank for r in pos]), 4) if pos else None,
            "negative_accuracy": (
                round(mean([1.0 if r.passed else 0.0 for r in group]), 4)
                if not pos
                else None
            ),
        }

    return {
        "k": k,
        "corpus_documents": len(CORPUS),
        "cases": len(CASES),
        "overall": {
            "precision@k": round(mean([r.precision for r in positives]), 4),
            "recall@k": round(mean([r.recall for r in positives]), 4),
            "mrr": round(mean([r.reciprocal_rank for r in positives]), 4),
            "negative_control_accuracy": round(
                mean([1.0 if r.passed else 0.0 for r in negatives]), 4
            ),
            "cases_passed": sum(1 for r in results if r.passed),
            "cases_total": len(results),
        },
        "by_category": by_category,
        "failures": [
            {
                "id": r.case.id,
                "category": r.case.category,
                "query": r.case.query,
                "expected": sorted(r.case.relevant) or ["(nothing)"],
                "retrieved": r.retrieved,
                "note": r.case.note,
            }
            for r in results
            if not r.passed
        ],
    }


def print_report(report: dict) -> None:
    k = report["k"]
    print("=" * 72)
    print("RARE RETRIEVAL EVALUATION (BM25)")
    print("=" * 72)
    print("Measures the RETRIEVER only. No model, no adapter, no generation.")
    print(f"Corpus: {report['corpus_documents']} documents | "
          f"Cases: {report['cases']} | k={k}")
    print()
    print(f"{'category':<16}{'cases':>7}{'passed':>8}{'P@k':>8}{'R@k':>8}{'MRR':>8}")
    print("-" * 72)
    for name, stats in report["by_category"].items():
        p = "-" if stats["precision@k"] is None else f"{stats['precision@k']:.3f}"
        r = "-" if stats["recall@k"] is None else f"{stats['recall@k']:.3f}"
        m = "-" if stats["mrr"] is None else f"{stats['mrr']:.3f}"
        print(f"{name:<16}{stats['cases']:>7}{stats['passed']:>8}{p:>8}{r:>8}{m:>8}")
    print("-" * 72)
    o = report["overall"]
    print(f"{'OVERALL':<16}{o['cases_total']:>7}{o['cases_passed']:>8}"
          f"{o['precision@k']:>8.3f}{o['recall@k']:>8.3f}{o['mrr']:>8.3f}")
    print()
    print(f"Negative-control accuracy: {o['negative_control_accuracy']:.3f}")
    print()

    if report["failures"]:
        print(f"FAILURES ({len(report['failures'])}) - recorded, not tuned away:")
        print("-" * 72)
        for failure in report["failures"]:
            print(f"  [{failure['category']}] {failure['id']}")
            print(f"    query:     {failure['query']}")
            print(f"    expected:  {', '.join(failure['expected'])}")
            print(f"    retrieved: {', '.join(failure['retrieved']) or '(nothing)'}")
            if failure["note"]:
                print(f"    note:      {failure['note']}")
        print()
    else:
        print("No failures.")
        print()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--k", type=int, default=3)
    parser.add_argument("--json", type=str, default=None)
    args = parser.parse_args()

    report = run(k=args.k)
    print_report(report)

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"JSON written to {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
