#!/usr/bin/env python3
"""Kell Quant Lab deterministic state core.

The AI writes one small intent. This program assigns IDs, validates references,
updates derived projections, writes an append-only transaction, and rebuilds a
compact context. The AI is not the database and never needs to remember IDs.
"""
from __future__ import annotations
import argparse, copy, datetime as dt, hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = ROOT / "config"
INTENT = DATA / "write_intent.json"
SYSTEM = DATA / "system_state.json"
CONTEXT = DATA / "context.json"

TERMINAL_H = {"REJECT", "REJECTED", "INCONCLUSIVE"}
H_RE = re.compile(r"^H(\d+)$")
E_RE = re.compile(r"^E(\d+)$")


def load(path: Path, default=None):
    if not path.exists():
        if default is None: raise FileNotFoundError(path)
        return copy.deepcopy(default)
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def now_iso():
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def digest(value):
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def max_id(items, rx):
    out = 0
    for item in items:
        m = rx.match(str(item.get("id", "")))
        if m: out = max(out, int(m.group(1)))
    return out


def normalize_research(research):
    # v2 originally used `cycles`; canonical form is now `entries`.
    for day in research.get("days", []):
        if "entries" not in day and "cycles" in day:
            day["entries"] = []
            for c in day.pop("cycles"):
                day["entries"].append({
                    "subcycle": c.get("cycle"), "time": c.get("time"),
                    "title": c.get("title"), "question": c.get("question"),
                    "markets": c.get("markets", []), "hypotheses": c.get("hypotheses", []),
                    "method": c.get("method"), "evidence": c.get("result"),
                    "limitations": c.get("limitations"), "decision": c.get("decision"),
                    "next_step": c.get("next_step"), "report": c.get("report"),
                    "summary": c.get("result")
                })
    return research


def reconcile(system, hypotheses, experiments):
    system.setdefault("schema_version", 1)
    system.setdefault("transaction_seq", 0)
    system.setdefault("last_intent_digest", None)
    system.setdefault("last_transaction", None)
    system["next_hypothesis_seq"] = max(system.get("next_hypothesis_seq", 1), max_id(hypotheses.get("hypotheses", []), H_RE) + 1)
    system["next_experiment_seq"] = max(system.get("next_experiment_seq", 1), max_id(experiments.get("experiments", []), E_RE) + 1)
    return system


def require(obj, *fields):
    missing = [f for f in fields if obj.get(f) in (None, "")]
    if missing: raise ValueError("missing required fields: " + ", ".join(missing))


def patch_dict(target, patch, forbidden=()):
    for k, v in patch.items():
        if k in forbidden: raise ValueError(f"field is immutable: {k}")
        target[k] = v


def find_by_id(items, object_id):
    for x in items:
        if x.get("id") == object_id: return x
    raise ValueError(f"unknown id: {object_id}")


def op_add_hypothesis(payload, state):
    require(payload, "market", "family", "description")
    seq = state["system"]["next_hypothesis_seq"]
    hid = f"H{seq:04d}"
    state["system"]["next_hypothesis_seq"] = seq + 1
    h = {
        "id": hid, "created_at": payload.get("created_at", now_iso()),
        "market": payload["market"], "family": payload["family"],
        "title": payload.get("title", payload["description"][:96]),
        "description": payload["description"], "mechanism": payload.get("mechanism"),
        "frozen_parameters": payload.get("frozen_parameters", {}),
        "origin": payload.get("origin", "Kell Quant Lab"),
        "variants": int(payload.get("variants", 1)), "tests": [],
        "stage": payload.get("stage", "OPEN"), "status": payload.get("status", payload.get("stage", "OPEN")),
        "decision": payload.get("decision", "HOLD"), "evidence": payload.get("evidence", "No empirical evidence yet."),
        "version": payload.get("version", "1.0.0")
    }
    state["hypotheses"].setdefault("hypotheses", []).append(h)
    return {"assigned_id": hid}


def op_update_hypothesis(payload, state):
    require(payload, "id")
    h = find_by_id(state["hypotheses"].get("hypotheses", []), payload["id"])
    patch_dict(h, payload.get("patch", {}), forbidden=("id", "created_at"))
    if "stage" in h: h["status"] = h.get("status", h["stage"])
    h["updated_at"] = now_iso()
    return {"updated_id": h["id"]}


def op_upsert_market(payload, state):
    key = payload.get("registry_key") or payload.get("symbol") or payload.get("name")
    if not key: raise ValueError("market needs registry_key, symbol, or name")
    markets = state["markets"].setdefault("markets", [])
    found = next((m for m in markets if (m.get("registry_key") or m.get("symbol") or m.get("name")) == key), None)
    if found: patch_dict(found, payload, forbidden=("registry_key",)); action = "updated"
    else:
        found = dict(payload); found.setdefault("registry_key", key); markets.append(found); action = "created"
    state["markets"]["updated_at"] = now_iso()
    return {"market": key, "action": action}


def op_add_experiment(payload, state):
    require(payload, "hypothesis_id", "stage")
    find_by_id(state["hypotheses"].get("hypotheses", []), payload["hypothesis_id"])
    seq = state["system"]["next_experiment_seq"]; eid = f"E{seq:06d}"
    state["system"]["next_experiment_seq"] = seq + 1
    e = dict(payload); e.update({"id": eid, "created_at": payload.get("created_at", now_iso())})
    state["experiments"].setdefault("experiments", []).append(e)
    return {"assigned_id": eid}


def op_update_experiment(payload, state):
    require(payload, "id")
    e = find_by_id(state["experiments"].get("experiments", []), payload["id"])
    patch_dict(e, payload.get("patch", {}), forbidden=("id", "created_at", "hypothesis_id")); e["updated_at"] = now_iso()
    return {"updated_id": e["id"]}


def op_add_research_cycle(payload, state):
    require(payload, "day", "date", "subcycle", "title", "decision")
    if payload["subcycle"] not in {"A", "B", "C"}: raise ValueError("subcycle must be A/B/C")
    days = state["research"].setdefault("days", [])
    day = next((d for d in days if int(d.get("day", -1)) == int(payload["day"])), None)
    if day is None:
        day = {"day": int(payload["day"]), "date": payload["date"], "title": payload.get("day_title", f"Dia {payload['day']}"), "entries": []}; days.append(day)
    entries = day.setdefault("entries", [])
    if any(x.get("subcycle") == payload["subcycle"] for x in entries):
        raise ValueError(f"cycle already exists: Day {payload['day']}{payload['subcycle']}")
    entry = {k:v for k,v in payload.items() if k not in {"day","date","day_title","report_content"}}
    entries.append(entry)
    if payload.get("report") and payload.get("report_content"):
        rp = ROOT / payload["report"]
        if rp.exists(): raise ValueError(f"report already exists: {payload['report']}")
        rp.parent.mkdir(parents=True, exist_ok=True); rp.write_text(payload["report_content"], encoding="utf-8")
    return {"cycle": f"Day {payload['day']}{payload['subcycle']}"}


def op_set_status(payload, state):
    # Narrative fields may be authored; numerical counters are rebuilt by code.
    for section in ("system_status", "now_summary"):
        if section in payload: state["status"][section] = payload[section]
    for section in ("research", "pipeline", "signal", "strategy", "performance"):
        if section in payload:
            state["status"].setdefault(section, {}); patch_dict(state["status"][section], payload[section])
    return {"status": "patched"}


def op_promote_demo_strategy(payload, state):
    strategy = dict(payload)
    if strategy.get("real_money_allowed") is True: raise ValueError("real money is permanently forbidden")
    if strategy.get("research_approved") is not True: raise ValueError("promotion requires research_approved=true")
    strategy["execution_enabled"] = True
    strategy["environment"] = "DERIV_DEMO_ONLY"
    strategy["real_money_allowed"] = False
    save(CONFIG / "production_strategy.json", strategy)
    return {"strategy": strategy.get("name"), "mode": "DEMO_ONLY"}

OPS = {
    "add_hypothesis": op_add_hypothesis, "update_hypothesis": op_update_hypothesis,
    "upsert_market": op_upsert_market, "add_experiment": op_add_experiment,
    "update_experiment": op_update_experiment, "add_research_cycle": op_add_research_cycle,
    "set_status": op_set_status, "promote_demo_strategy": op_promote_demo_strategy,
}


def derive(state):
    hs = state["hypotheses"].get("hypotheses", []); ms = state["markets"].get("markets", []); ex = state["experiments"].get("experiments", [])
    state["hypotheses"].setdefault("counters", {})
    state["hypotheses"]["counters"].update({
        "hypotheses": len(hs), "parameter_variants": sum(int(h.get("variants", 0) or 0) for h in hs), "markets_examined": len(ms)
    })
    s = state["status"]; metric = s.setdefault("experiment", {})
    metric["hypotheses_cumulative"] = len(hs); metric["parameter_variants"] = state["hypotheses"]["counters"]["parameter_variants"]; metric["markets_examined"] = len(ms)
    metric["shadow_candidates"] = sum(1 for e in ex if e.get("stage") == "SHADOW")
    metric["demo_strategies"] = sum(1 for e in ex if e.get("stage") == "DEMO")
    active = [h for h in hs if h.get("decision") not in TERMINAL_H]
    latest = None
    for d in state["research"].get("days", []):
        for e in d.get("entries", []): latest = {"day":d.get("day"),"date":d.get("date"),"subcycle":e.get("subcycle"),"title":e.get("title"),"decision":e.get("decision"),"next_step":e.get("next_step")}
    strategy = load(CONFIG / "production_strategy.json", {})
    context = {
        "schema_version": 1, "generated_at": now_iso(), "program": state["research"].get("program"),
        "counts": {"markets":len(ms),"hypotheses":len(hs),"experiments":len(ex),"active_hypotheses":len(active)},
        "next_ids_are_system_assigned": True,
        "active_hypotheses": [{"id":h.get("id"),"market":h.get("market"),"family":h.get("family"),"stage":h.get("stage"),"decision":h.get("decision"),"version":h.get("version")} for h in active[-25:]],
        "latest_cycle": latest,
        "champion": {"name":strategy.get("name"),"status":strategy.get("status"),"execution_enabled":strategy.get("execution_enabled",False),"research_approved":strategy.get("research_approved",False)},
        "write_protocol": "Read context + relevant records; write only data/write_intent.json. Never calculate IDs or dashboard counters manually."
    }
    save(CONTEXT, context)


def validate(state):
    hs = state["hypotheses"].get("hypotheses", []); ex = state["experiments"].get("experiments", [])
    ids = [h.get("id") for h in hs]
    if len(ids) != len(set(ids)): raise ValueError("duplicate hypothesis ID")
    eids = [e.get("id") for e in ex]
    if len(eids) != len(set(eids)): raise ValueError("duplicate experiment ID")
    known = set(ids)
    for e in ex:
        if e.get("hypothesis_id") and e["hypothesis_id"] not in known: raise ValueError(f"broken hypothesis reference in {e.get('id')}")
    risk = load(CONFIG / "risk_limits.json", {})
    if risk.get("real_money_allowed") is not False or risk.get("fail_closed") is not True: raise ValueError("financial safety invariant violated")
    strategy = load(CONFIG / "production_strategy.json", {})
    if strategy.get("real_money_allowed") is True or strategy.get("environment") not in (None, "DERIV_DEMO_ONLY"): raise ValueError("strategy violates DEMO-only invariant")
    return True


def load_state():
    hypotheses = load(DATA / "hypotheses.json", {"hypotheses":[]}); experiments = load(DATA / "experiments.json", {"experiments":[],"shadow":[],"demo":[]})
    state = {
        "hypotheses": hypotheses, "experiments": experiments, "markets": load(DATA / "markets.json", {"markets":[]}),
        "research": normalize_research(load(DATA / "research.json", {"days":[]})), "status": load(DATA / "status.json", {}),
        "system": load(SYSTEM, {"schema_version":1,"transaction_seq":0,"next_hypothesis_seq":1,"next_experiment_seq":1})
    }
    state["system"] = reconcile(state["system"], hypotheses, experiments)
    return state


def persist(state):
    derive(state); validate(state)
    save(DATA / "hypotheses.json", state["hypotheses"]); save(DATA / "experiments.json", state["experiments"])
    save(DATA / "markets.json", state["markets"]); save(DATA / "research.json", state["research"]); save(DATA / "status.json", state["status"]); save(SYSTEM, state["system"])


def apply_intent():
    intent = load(INTENT)
    if not intent.get("pending"): print("No pending intent."); return
    state = load_state(); d = digest({k:v for k,v in intent.items() if k not in {"pending","processed_at","last_transaction"}})
    if d == state["system"].get("last_intent_digest"):
        intent["pending"] = False; intent["processed_at"] = now_iso(); save(INTENT, intent); print("Duplicate intent ignored."); return
    operations = intent.get("operations", [])
    if not operations: raise ValueError("pending intent has no operations")
    results = []
    for item in operations:
        kind = item.get("op")
        if kind not in OPS: raise ValueError(f"unsupported operation: {kind}")
        results.append({"op":kind, **OPS[kind](item.get("payload", {}), state)})
    state["system"]["transaction_seq"] += 1; txid = f"T{state['system']['transaction_seq']:09d}"
    state["system"]["last_intent_digest"] = d; state["system"]["last_transaction"] = txid
    persist(state)
    stamp = dt.datetime.now().astimezone(); tx = {"id":txid,"applied_at":now_iso(),"intent_digest":d,"actor":intent.get("actor"),"cycle":intent.get("cycle"),"note":intent.get("note"),"operations":operations,"results":results}
    save(ROOT / "ledger" / "transactions" / f"{stamp.year:04d}" / f"{stamp.month:02d}" / f"{txid}.json", tx)
    intent.update({"pending":False,"processed_at":now_iso(),"last_transaction":txid,"last_results":results,"operations":[]}); save(INTENT, intent)
    print(json.dumps({"transaction":txid,"results":results}, ensure_ascii=False))


def rebuild():
    state = load_state(); persist(state); print("State rebuilt and validated.")


def main():
    p=argparse.ArgumentParser(); p.add_argument("command", choices=("apply-intent","rebuild","validate")); a=p.parse_args()
    if a.command == "apply-intent": apply_intent()
    elif a.command == "rebuild": rebuild()
    else: validate(load_state()); print("Integrity OK.")

if __name__ == "__main__": main()
