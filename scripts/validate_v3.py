#!/usr/bin/env python3
"""Structural, scientific-preservation and fail-closed checks for V3."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def main():
    errors = []
    for p in ROOT.rglob("*.json"):
        try: json.loads(p.read_text(encoding="utf-8"))
        except Exception as exc: errors.append(f"JSON inválido {p.relative_to(ROOT)}: {exc}")
    for p in ROOT.glob("events/**/*.jsonl"):
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            try: json.loads(line)
            except Exception as exc: errors.append(f"JSONL inválido {p.relative_to(ROOT)}:{n}: {exc}")
    current = read("state/current.json")
    for key in ("schema_version", "current_run_id", "active_hypotheses", "executor_state", "relevant_pointers"):
        if key not in current: errors.append(f"current.json sem {key}")
    if len(json.dumps(current, ensure_ascii=False).encode()) > 32_000: errors.append("current.json excede 32 KB")
    for path in current["relevant_pointers"].values():
        if not (ROOT / path).exists(): errors.append(f"Ponteiro ausente: {path}")
    page = read("indexes/recent/runs-page-001.json")
    ids = {x["run_id"] for x in page["items"]}
    if "RUN-20260830-02B-R1" not in ids or "RUN-20260830-02B-R2" not in ids: errors.append("Cadeia 2B ausente do índice")
    r1 = next(x for x in page["items"] if x["run_id"] == "RUN-20260830-02B-R1")
    r2 = next(x for x in page["items"] if x["run_id"] == "RUN-20260830-02B-R2")
    if r1["canonical"] or r1["superseded_by"] != r2["run_id"]: errors.append("R1 2B não preservado/superseded corretamente")
    if not r2["canonical"] or r2["supersedes"] != r1["run_id"]: errors.append("R2 2B não é o canônico correto")
    manifest = read("datasets/manifests/DS-20260830-DERIV-CRASHBOOM-2B-R2.json")
    raw = (ROOT / manifest["storage_location"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest["sha256"]: errors.append("Hash do dataset divergente")
    risk, strategy = read("config/risk_limits.json"), read("config/production_strategy.json")
    if risk != {**risk, "environment": "DEMO_ONLY", "real_money_allowed": False, "fail_closed": True}: errors.append("Risco não está fail-closed DEMO_ONLY")
    if strategy.get("execution_enabled") or strategy.get("research_approved") or strategy.get("status") != "NO_CHAMPION": errors.append("Executor/champion alterado indevidamente")
    for run in page["items"]:
        if not (ROOT / run["record_path"]).exists(): errors.append(f"Run ausente: {run['record_path']}")
    if errors:
        raise SystemExit("\n".join(errors))
    print("V3 válida: JSON/JSONL, índices, ponteiros, manifestos, snapshots, superseding e executor fail-closed.")
    print("NENHUMA ORDEM FOI ENVIADA.")


if __name__ == "__main__": main()
