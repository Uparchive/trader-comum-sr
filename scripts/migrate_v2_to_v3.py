#!/usr/bin/env python3
"""Deterministic, idempotent V2 -> V3 materializer.

Source V2 files are never deleted or rewritten. V3 files are regenerated from the
immutable ledger and current V2 projections, so a second execution is a no-op.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path: str, default=None):
    p = ROOT / path
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def write_json(path: str | Path, value) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if not p.exists() or p.read_text(encoding="utf-8") != text:
        p.write_text(text, encoding="utf-8")


def write_text(path: str | Path, value: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    if not value.endswith("\n"):
        value += "\n"
    if not p.exists() or p.read_text(encoding="utf-8") != value:
        p.write_text(value, encoding="utf-8")


def iso_stamp(value: str | None, fallback_date: str) -> str:
    if value and "T" in value:
        return value
    time = (value or "").split()[-1] if ":" in (value or "") else "00:00"
    return f"{fallback_date}T{time}:00-03:00"


def commit_for(path: str) -> str:
    # Preserves the last known source commit when Git metadata is unavailable.
    commits = {
        "research/2026-08-30-day-02B-retest.md": "4501f4b",
        "research/2026-08-30-day-02B-validation.md": "f4661adff4d5ea1cd1bc639b212149b5a28562ae",
    }
    return commits.get(path, "f4661adff4d5ea1cd1bc639b212149b5a28562ae")


def temperature(record_date: str, current_date: str, hot: int, warm: int) -> str:
    age = (date.fromisoformat(current_date) - date.fromisoformat(record_date)).days
    return "HOT" if age <= hot else ("WARM" if age <= warm else "COLD")


def make_run(*, run_id, day, run_date, subcycle, revision, source, entry,
             status, canonical, supersedes=None, superseded_by=None,
             legacy=False, failure_type=None):
    return {
        "schema_version": 3,
        "run_id": run_id,
        "date": run_date,
        "day": day,
        "subcycle": subcycle,
        "revision": revision,
        "created_at": iso_stamp(entry.get("time"), run_date),
        "record_status": status,
        "canonical": canonical,
        "legacy": legacy,
        "hypothesis_ids": entry.get("hypotheses", []),
        "experiment_ids": ["E000001"] if "H0001" in entry.get("hypotheses", []) and day == 2 and subcycle == "B" else [],
        "dataset_manifest": "DS-20260830-DERIV-CRASHBOOM-2B-R2" if revision == 2 and day == 2 and subcycle == "B" else None,
        "code_commit": commit_for(source),
        "decision": entry.get("decision", "HOLD — INCONCLUSIVE"),
        "report": source,
        "supersedes": supersedes,
        "superseded_by": superseded_by,
        "failure_type": failure_type,
        "audit_status": entry.get("audit", "LEGACY" if legacy else "PRESERVED"),
        "title": entry.get("title", run_id),
        "question": entry.get("question"),
        "summary": entry.get("summary", entry.get("note", "Registro histórico preservado sem reinterpretação.")),
        "next_step": entry.get("next_step"),
        "historical_disposition": "PRESERVED_OBSOLETE" if superseded_by else None,
    }


def build_runs(research, legacy):
    runs = []
    for item in legacy.get("entries", []):
        m = re.search(r"(\d{4}-\d{2}-\d{2})-(\d+)([ABC])$", item.get("id", ""))
        run_date, cycle = (m.group(1), m.group(3)) if m else ("2026-08-28", "A")
        entry = {**item, "time": "00:00", "hypotheses": [], "summary": legacy.get("reason")}
        runs.append(make_run(run_id=f"RUN-{run_date.replace('-', '')}-00{cycle}-R1", day=0,
            run_date=run_date, subcycle=cycle, revision=1, source=item["source"], entry=entry,
            status="LEGACY", canonical=True, legacy=True))
    for day in research.get("days", []):
        for entry in day.get("entries", []):
            d, c, n = day["date"], entry["subcycle"], int(day["day"])
            if entry.get("prior_attempt"):
                prior = entry["prior_attempt"]
                r1 = f"RUN-{d.replace('-', '')}-{n:02d}{c}-R1"
                r2 = f"RUN-{d.replace('-', '')}-{n:02d}{c}-R2"
                prior_entry = {**prior, "hypotheses": entry.get("hypotheses", []),
                    "summary": prior.get("note"), "next_step": "Retestar após corrigir a aquisição sem alterar o pré-registro."}
                runs.append(make_run(run_id=r1, day=n, run_date=d, subcycle=c, revision=1,
                    source=prior["report"], entry=prior_entry, status="FAILED_TECHNICAL",
                    canonical=False, superseded_by=r2, failure_type="DNS_ACQUISITION_FAILURE"))
                runs.append(make_run(run_id=r2, day=n, run_date=d, subcycle=c, revision=2,
                    source=entry["report"], entry=entry, status="OFFICIAL", canonical=True,
                    supersedes=r1))
            else:
                rid = f"RUN-{d.replace('-', '')}-{n:02d}{c}-R1"
                runs.append(make_run(run_id=rid, day=n, run_date=d, subcycle=c, revision=1,
                    source=entry["report"], entry=entry, status="OFFICIAL", canonical=True))
    return sorted(runs, key=lambda r: (r["date"], r["day"], r["subcycle"], r["revision"]))


def materialize_reports(runs):
    for run in runs:
        folder = Path("research") / run["date"][:4] / run["date"][5:7] / run["date"] / f"cycle-{run['subcycle']}" / run["run_id"]
        run["record_path"] = str(folder / "run.json")
        run["partitioned_report"] = str(folder / "report.md")
        source = ROOT / run["report"]
        target = ROOT / run["partitioned_report"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.exists() and (not target.exists() or source.read_bytes() != target.read_bytes()):
            shutil.copyfile(source, target)
        write_json(run["record_path"], run)


def dataset_manifest(generated_at):
    path = ROOT / "data/acquisition/day-02b-retry-2026-08-30.json"
    raw = path.read_bytes()
    data = json.loads(raw)
    datasets = data.get("datasets") or data.get("symbols") or data.get("results") or []
    count = sum(int(x.get("record_count", x.get("tick_count", len(x.get("ticks", []))))) for x in datasets if isinstance(x, dict))
    return {
        "schema_version": 3,
        "dataset_id": "DS-20260830-DERIV-CRASHBOOM-2B-R2",
        "created_at": generated_at,
        "source": "Deriv public WebSocket market-data API via Cloudflare read-only research gateway",
        "symbols": [x.get("symbol") for x in datasets if isinstance(x, dict) and x.get("symbol")],
        "period_start": min((x.get("period_start") for x in datasets if isinstance(x, dict) and x.get("period_start")), default=None),
        "period_end": max((x.get("period_end") for x in datasets if isinstance(x, dict) and x.get("period_end")), default=None),
        "record_count": count or None,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "size_bytes": len(raw),
        "acquisition_method": "research-2b-retry GitHub Actions runner; immutable source preserved",
        "code_commit": "4501f4b",
        "storage_location": "data/acquisition/day-02b-retry-2026-08-30.json",
        "used_by_runs": ["RUN-20260830-02B-R2"],
        "validation_status": "VALIDATED_PRESENT_AND_HASHED",
        "retention_class": "SCIENTIFIC_PERMANENT",
    }


def main():
    cfg = load("config/v3_architecture.json")
    status, context = load("data/status.json"), load("data/context.json")
    research, legacy = load("data/research.json"), load("data/research_legacy.json")
    hypotheses, experiments, markets = load("data/hypotheses.json"), load("data/experiments.json"), load("data/markets.json")
    generated_at = context.get("generated_at") or status["research"]["date"] + "T23:59:59Z"
    current_date = status["research"]["date"]
    runs = build_runs(research, legacy)
    for run in runs:
        run["temperature"] = temperature(run["date"], current_date, cfg["hot_window_days"], cfg["warm_window_days"])
    materialize_reports(runs)

    manifest = dataset_manifest(generated_at)
    write_json(f"datasets/manifests/{manifest['dataset_id']}.json", manifest)
    write_json("datasets/indexes/by-id.json", {"schema_version": 3, "items": {manifest["dataset_id"]: f"datasets/manifests/{manifest['dataset_id']}.json"}})

    run_summaries = [{k: r.get(k) for k in ("run_id", "date", "day", "subcycle", "revision", "record_status", "canonical", "legacy", "title", "summary", "decision", "hypothesis_ids", "experiment_ids", "dataset_manifest", "supersedes", "superseded_by", "failure_type", "temperature", "record_path", "partitioned_report")} for r in reversed(runs)]
    hot = [r for r in run_summaries if r["temperature"] == "HOT"]
    page_size = cfg["page_size"]
    pages = [hot[i:i + page_size] for i in range(0, len(hot), page_size)] or [[]]
    for i, items in enumerate(pages, 1):
        write_json(f"indexes/recent/runs-page-{i:03d}.json", {"schema_version": 3, "page": i,
            "page_size": page_size, "total": len(hot), "items": items,
            "next": f"indexes/recent/runs-page-{i+1:03d}.json" if i < len(pages) else None})
    write_json("indexes/recent/manifest.json", {"schema_version": 3, "generated_at": generated_at,
        "hot_window_days": cfg["hot_window_days"], "pages": len(pages), "total": len(hot), "first_page": "indexes/recent/runs-page-001.json"})

    months = sorted({r["date"][:7] for r in runs})
    for month in months:
        items = [r for r in run_summaries if r["date"].startswith(month)]
        write_json(f"indexes/days/{month}.json", {"schema_version": 3, "month": month, "items": items})
        write_json(f"indexes/search/{month}.json", {"schema_version": 3, "month": month,
            "items": [{"run_id": r["run_id"], "text": " ".join(str(r.get(k, "")) for k in ("run_id", "date", "title", "summary", "decision", "record_status", "hypothesis_ids", "experiment_ids", "dataset_manifest")).lower(), "record_path": r["record_path"]} for r in items]})
        write_json(f"indexes/decisions/{month}.json", {"schema_version": 3, "month": month,
            "items": [{"run_id": r["run_id"], "decision": r["decision"], "canonical": r["canonical"], "record_path": r["record_path"]} for r in items]})
    write_json("indexes/search/manifest.json", {"schema_version": 3, "months": list(reversed(months)), "default_month": current_date[:7]})

    for h in hypotheses.get("hypotheses", []):
        hruns = [r for r in run_summaries if h["id"] in r.get("hypothesis_ids", [])]
        write_json(f"indexes/hypotheses/{h['id']}.json", {"schema_version": 3, "hypothesis": h,
            "runs": hruns, "datasets": [manifest["dataset_id"]] if h["id"] == "H0001" else [],
            "timeline": [{"date": r["date"], "run_id": r["run_id"], "status": r["record_status"], "decision": r["decision"], "canonical": r["canonical"]} for r in reversed(hruns)]})
    for e in experiments.get("experiments", []):
        eruns = [r for r in run_summaries if e["id"] in r.get("experiment_ids", [])]
        write_json(f"indexes/experiments/{e['id']}.json", {"schema_version": 3, "experiment": e,
            "runs": eruns, "dataset_manifests": [manifest["dataset_id"]]})
    write_json("indexes/markets/current.json", {"schema_version": 3, "updated_at": markets.get("updated_at"), "items": markets.get("markets", [])})

    activity = [{"event_id": f"ACT-{i:06d}", **item} for i, item in enumerate(status.get("activity", []), 1)]
    current_month = current_date[:7]
    write_json(f"indexes/activity/{current_month}.json", {"schema_version": 3, "items": activity})
    write_json("indexes/recent/activity-page-001.json", {"schema_version": 3, "page": 1, "page_size": page_size, "total": len(activity), "next": None, "items": activity[:page_size]})

    latest = next(r for r in run_summaries if r["canonical"] and not r.get("legacy"))
    current = {
        "schema_version": 3, "program_version": cfg["program_version"], "current_day": latest["day"],
        "current_cycle": latest["subcycle"], "current_run_id": latest["run_id"], "current_date": latest["date"],
        "active_hypotheses": [h["id"] for h in hypotheses.get("hypotheses", []) if h.get("status", h.get("stage")) in ("OPEN", "VALIDATING")],
        "active_experiments": [e["id"] for e in experiments.get("experiments", []) if not str(e.get("status", "")).startswith(("REJECTED", "COMPLETED"))],
        "current_champion": status["strategy"], "pipeline_stage": status["pipeline"]["stage"],
        "latest_decision": latest["decision"], "latest_report": latest["partitioned_report"],
        "latest_dataset_manifest": f"datasets/manifests/{manifest['dataset_id']}.json",
        "blockers": ["Massa de eventos ainda insuficiente para inferência familiar robusta"],
        "next_step": status["pipeline"]["next_step"],
        "executor_state": {"state": status["signal"]["state"], "status": status["experiment"]["executor_status"], "execution_enabled": False, "research_approved": False, "fail_closed": True},
        "environment": "DEMO_ONLY", "latest_snapshot": f"snapshots/monthly/snapshot-month-{current_month}.json",
        "relevant_pointers": {"recent_runs": "indexes/recent/runs-page-001.json", "hypothesis_focus": "indexes/hypotheses/H0001.json", "experiment_focus": "indexes/experiments/E000001.json", "activity": "indexes/recent/activity-page-001.json"},
        "what_changed": "A aquisição 2B foi corrigida e o reteste oficial substituiu a falha técnica como resultado vigente, sem apagar a primeira tentativa. H0001 continua HOLD por evidência insuficiente.",
        "generated_at": generated_at,
    }
    write_json("state/current.json", current)

    canonical = [r for r in run_summaries if r["canonical"]]
    iso_year, iso_week, _ = date.fromisoformat(current_date).isocalendar()
    current_year = current_date[:4]
    snapshot = {"schema_version": 3, "period": current_month, "generated_at": generated_at,
        "state": current, "counts": {"runs": len(runs), "canonical_runs": len(canonical), "hypotheses": len(hypotheses.get("hypotheses", [])), "experiments": len(experiments.get("experiments", [])), "markets": len(markets.get("markets", []))},
        "champion": status["strategy"], "decisions": [{"run_id": r["run_id"], "decision": r["decision"]} for r in canonical],
        "failures": [{"run_id": r["run_id"], "failure_type": r["failure_type"], "superseded_by": r["superseded_by"]} for r in run_summaries if r["failure_type"]],
        "promotions": [], "rejections": [], "dataset_manifests": [manifest["dataset_id"]]}
    write_json(f"snapshots/weekly/snapshot-week-{iso_year}-W{iso_week:02d}.json", {**snapshot, "period": f"{iso_year}-W{iso_week:02d}"})
    write_json(f"snapshots/monthly/snapshot-month-{current_month}.json", snapshot)
    write_json(f"snapshots/yearly/snapshot-year-{current_year}.json", {**snapshot, "period": current_year})
    cold = [r for r in run_summaries if r["temperature"] == "COLD"]
    write_json(f"archive/{current_year}/index.json", {"schema_version": 3, "year": int(current_year), "cold_records": cold, "note": "Índice de localização; os registros científicos não são apagados."})

    events = []
    for r in runs:
        events.append({"event_id": f"EVT-{len(events)+1:06d}", "event_type": "RUN_FAILED" if r["record_status"] == "FAILED_TECHNICAL" else "RUN_COMPLETED", "occurred_at": r["created_at"], "run_id": r["run_id"], "record_path": r["record_path"]})
        if r.get("supersedes"):
            events.extend([
                {"event_id": f"EVT-{len(events)+1:06d}", "event_type": "RETEST_CREATED", "occurred_at": r["created_at"], "run_id": r["run_id"], "supersedes": r["supersedes"]},
                {"event_id": f"EVT-{len(events)+2:06d}", "event_type": "RECORD_SUPERSEDED", "occurred_at": r["created_at"], "run_id": r["supersedes"], "superseded_by": r["run_id"]},
            ])
    events.extend([
        {"event_id": f"EVT-{len(events)+1:06d}", "event_type": "DATASET_REGISTERED", "occurred_at": generated_at, "dataset_id": manifest["dataset_id"]},
        {"event_id": f"EVT-{len(events)+2:06d}", "event_type": "SNAPSHOT_CREATED", "occurred_at": generated_at, "snapshot": f"snapshots/monthly/snapshot-month-{current_month}.json"},
    ])
    event_months = {}
    for event in events:
        month = event["occurred_at"][:7]
        event_months.setdefault(month, []).append(event)
    for month, month_events in event_months.items():
        year, mm = month.split("-")
        write_text(f"events/{year}/{mm}/events-{month}.jsonl", "\n".join(json.dumps(e, ensure_ascii=False, sort_keys=True) for e in month_events))
    print(f"V3 materializada: {len(runs)} runs, {len(events)} eventos, {len(pages)} página(s) HOT.")


if __name__ == "__main__":
    main()
