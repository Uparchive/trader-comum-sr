#!/usr/bin/env python3
"""Deterministically project canonical research state into dashboard status and evidence index."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EVIDENCE_INDEX = ROOT / "indexes" / "evidence" / "recent.json"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def research_cycles(research):
    rows = []
    for day in research.get("days", []):
        for entry in day.get("entries", []):
            rows.append((day, entry))
    return rows


def compact(text, limit=220):
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."


def activity_message(day, entry):
    subcycle = entry.get("subcycle", "?")
    title = entry.get("title") or "Research cycle"
    decision = entry.get("decision")
    summary = compact(entry.get("summary") or entry.get("evidence"))
    parts = [f"Dia {day.get('day')}{subcycle}: {title}"]
    if decision:
        parts.append(str(decision))
    if summary:
        parts.append(summary)
    return " · ".join(parts)


def build_activity(research, legacy=None, limit=12):
    rows = []
    for day, entry in reversed(research_cycles(research)):
        date = day.get("date")
        time = entry.get("time")
        stamp = f"{date} {time}" if date and time else str(date or "—")
        row = {"time": stamp, "message": activity_message(day, entry)}
        if entry.get("report"):
            row["report"] = entry["report"]
        rows.append(row)
        if len(rows) >= limit:
            return rows

    if legacy:
        for item in reversed(legacy.get("entries", [])):
            source = str(item.get("source", ""))
            name = source.split("/")[-1]
            date = name[:10] if len(name) >= 10 else "2026-08-28"
            rows.append({
                "time": date,
                "message": f"{item.get('title', 'Registro legado')} · {item.get('decision', 'ARCHIVED')} · legado pré-arquitetura",
                "report": item.get("source"),
            })
            if len(rows) >= limit:
                break
    return rows


def _first_market(entry):
    market = entry.get("market")
    if market:
        return market
    markets = entry.get("markets")
    if isinstance(markets, list) and markets:
        return markets[0]
    return "—"


def _hypothesis(entry):
    value = entry.get("hypothesis")
    if value:
        return value
    values = entry.get("hypotheses")
    if isinstance(values, list) and values:
        return " · ".join(str(x) for x in values)
    return None


def canonical_evidence_item(day, entry):
    date = str(day.get("date") or "")
    day_number = day.get("day")
    subcycle = str(entry.get("subcycle") or "?")
    compact_date = date.replace("-", "")
    title = entry.get("title") or "Research cycle"
    if not str(title).startswith("Dia "):
        title = f"Dia {day_number}{subcycle} — {title}"
    item = {
        "evidence_id": f"EVD-{compact_date}-{day_number}{subcycle}",
        "title": title,
        "date": date,
        "cycle": subcycle,
        "market": _first_market(entry),
        "strategy": entry.get("strategy_version") or entry.get("strategy") or "—",
        "hypothesis": _hypothesis(entry),
        "decision": entry.get("decision") or "OPEN",
        "summary": entry.get("summary") or entry.get("evidence") or "",
        "question": entry.get("question") or "",
        "method": entry.get("method") or entry.get("methodology") or "",
        "evidence": entry.get("evidence") or "",
        "limitations": entry.get("limitations") or "",
        "next_step": entry.get("next_step") or "",
    }
    report = entry.get("report")
    if report:
        item["report"] = report
    return item


def build_evidence_index(research, previous=None):
    canonical = [canonical_evidence_item(day, entry) for day, entry in reversed(research_cycles(research))]
    seen = {item["evidence_id"] for item in canonical}

    # Preserve historical/special evidence records that are not represented by the
    # canonical research diary (for example migration records). Canonical cycles win.
    extras = []
    for item in (previous or {}).get("items", []):
        evidence_id = item.get("evidence_id")
        if evidence_id and evidence_id not in seen:
            extras.append(item)

    generated_at = None
    if canonical:
        generated_at = canonical[0].get("date")
    return {
        "schema_version": 4,
        "generated_at": generated_at,
        "items": canonical + extras,
    }


def main():
    research = load(DATA / "research.json")
    status = load(DATA / "status.json")
    cycles = research_cycles(research)
    if not cycles:
        return

    day, entry = cycles[-1]
    subcycle = entry.get("subcycle")
    date = day.get("date")
    time = entry.get("time")
    if not (subcycle and date and time):
        raise ValueError("latest research cycle must contain subcycle, date and time")

    exp = status.setdefault("experiment", {})
    exp["cycle"] = f"Dia {day.get('day')}{subcycle} / 90 dias"
    exp["day"] = int(day.get("day"))
    exp["updated_at"] = f"{date} {time} America/Sao_Paulo"

    # Hero metadata is a projection of the canonical diary, never a manually synchronized copy.
    status["research"] = {
        "date": date,
        "title": f"Dia {day.get('day')}{subcycle} — {entry.get('title') or 'Research cycle'}",
        "summary": entry.get("summary") or entry.get("evidence") or "",
        "decision": entry.get("decision") or "OPEN",
    }

    legacy_path = DATA / "research_legacy.json"
    legacy = load(legacy_path) if legacy_path.exists() else None
    status["activity"] = build_activity(research, legacy)
    save(DATA / "status.json", status)

    previous_index = load(EVIDENCE_INDEX) if EVIDENCE_INDEX.exists() else None
    save(EVIDENCE_INDEX, build_evidence_index(research, previous_index))


if __name__ == "__main__":
    main()
