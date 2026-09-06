#!/usr/bin/env python3
"""Fail if dashboard projections drift from canonical research state."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EVIDENCE_INDEX = ROOT / "indexes" / "evidence" / "recent.json"


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def latest_cycle(research):
    rows = [(day, entry) for day in research.get("days", []) for entry in day.get("entries", [])]
    return rows[-1] if rows else (None, None)


def main():
    research = load("research.json")
    status = load("status.json")
    day, entry = latest_cycle(research)
    if not day or not entry:
        print("Projection check skipped: no canonical research cycle.")
        return

    subcycle = entry.get("subcycle")
    date = day.get("date")
    time = entry.get("time")
    expected_cycle = f"Dia {day.get('day')}{subcycle} / 90 dias"
    expected_updated = f"{date} {time} America/Sao_Paulo"
    expected_title = f"Dia {day.get('day')}{subcycle} — {entry.get('title') or 'Research cycle'}"
    expected_decision = entry.get("decision") or "OPEN"

    exp = status.get("experiment", {})
    research_view = status.get("research", {})
    activity = status.get("activity", [])

    errors = []
    if exp.get("cycle") != expected_cycle:
        errors.append(f"experiment.cycle drift: {exp.get('cycle')!r} != {expected_cycle!r}")
    if exp.get("day") != int(day.get("day")):
        errors.append("experiment.day drift")
    if exp.get("updated_at") != expected_updated:
        errors.append(f"experiment.updated_at drift: {exp.get('updated_at')!r} != {expected_updated!r}")
    if research_view.get("title") != expected_title:
        errors.append(f"research.title drift: {research_view.get('title')!r} != {expected_title!r}")
    if research_view.get("decision") != expected_decision:
        errors.append("research.decision drift")
    if not activity:
        errors.append("activity feed is empty")
    else:
        expected_stamp = f"{date} {time}"
        if activity[0].get("time") != expected_stamp:
            errors.append(f"activity[0].time drift: {activity[0].get('time')!r} != {expected_stamp!r}")
        expected_prefix = f"Dia {day.get('day')}{subcycle}:"
        if not str(activity[0].get("message", "")).startswith(expected_prefix):
            errors.append("activity[0] does not represent latest canonical cycle")

    if not EVIDENCE_INDEX.exists():
        errors.append("indexes/evidence/recent.json is missing")
    else:
        index = json.loads(EVIDENCE_INDEX.read_text(encoding="utf-8"))
        items = index.get("items", []) if isinstance(index, dict) else []
        if not items:
            errors.append("evidence index is empty")
        else:
            latest = items[0]
            expected_evidence_id = f"EVD-{str(date).replace('-', '')}-{day.get('day')}{subcycle}"
            if latest.get("evidence_id") != expected_evidence_id:
                errors.append(
                    f"evidence index drift: {latest.get('evidence_id')!r} != {expected_evidence_id!r}"
                )
            if latest.get("date") != date:
                errors.append("evidence index latest date drift")
            if latest.get("cycle") != subcycle:
                errors.append("evidence index latest cycle drift")
            if latest.get("decision") != expected_decision:
                errors.append("evidence index latest decision drift")

    if errors:
        raise SystemExit("Dashboard projection integrity failed:\n- " + "\n- ".join(errors))
    print("Dashboard projection integrity OK.")


if __name__ == "__main__":
    main()
