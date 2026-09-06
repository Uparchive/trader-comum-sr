"""Deterministic V4 domain core. No network, secrets or REAL path."""
from __future__ import annotations
import hashlib, json, math
from dataclasses import dataclass
from typing import Iterable

OFF_STATES = {"TECHNICAL_FAIL_CLOSED", "PLATFORM_REJECTED", "STATE_CORRUPTED", "CREDENTIAL_MISMATCH", "RECONCILIATION_FAILURE", "TECHNICAL_KILL_SWITCH"}
RUN_STATES = {"WAITING_SIGNAL", "EXECUTING", "MONITORING", "SETTLING"}

def canonical_hash(value: dict) -> str:
    clean = {k: v for k, v in value.items() if k != "hash"}
    return hashlib.sha256(json.dumps(clean, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

def validate_demo_only(governance: dict) -> None:
    assert governance["environment"] == "DEMO_ONLY"
    assert governance["real_money_allowed"] is False
    assert governance.get("real_endpoint_paths") == []
    assert governance.get("auto_promotion_to_real") is False

def validate_mandate(m: dict, governance: dict) -> None:
    validate_demo_only(governance)
    required = {"mandate_id", "strategy_id", "strategy_version", "capital_policy_id", "capital_policy_version", "market_selection_id", "market_selection_version", "authorized_markets", "entry", "exit", "duration", "sizing", "valid_from", "valid_until", "authorizing_cycle", "state", "environment"}
    missing = required - m.keys()
    if missing: raise ValueError(f"Mandato incompleto: {sorted(missing)}")
    if m["environment"] != "DEMO_ONLY" or m["state"] != "ACTIVE": raise ValueError("Mandato não autoriza DEMO")
    if not 1 <= len(m["authorized_markets"]) <= 3: raise ValueError("Mandato deve autorizar 1–3 mercados")
    if m.get("hash") not in (None, "GENERATED_BY_MATERIALIZER", canonical_hash(m)): raise ValueError("Hash do mandato inválido")

def select_incumbent(registry: dict) -> str:
    champion = registry.get("champion")
    if champion: return champion
    baselines = [s for s in registry.get("strategies", []) if s.get("kind") == "BASELINE" and s.get("status") == "OPERATIONAL_INCUMBENT"]
    if not baselines: raise ValueError("Sem Champion exige Baseline operacional")
    return baselines[-1]["version"]

def executor_state(platform_state: str, healthy: bool, signal: str | None = None, open_position: bool = False) -> str:
    if platform_state == "PLATFORM_REJECTED": return "PLATFORM_REJECTED"
    if not healthy: return "TECHNICAL_FAIL_CLOSED"
    if open_position: return "MONITORING"
    if signal in {"CALL", "PUT"}: return "EXECUTING"
    return "WAITING_SIGNAL"

def capital_size(balance: float, policy: dict) -> float:
    if not math.isfinite(balance) or balance <= 0: raise ValueError("Saldo DEMO inválido")
    p = policy["parameters"]
    raw = balance * float(p["equity_fraction"])
    bounded = max(float(p["min_stake"]), min(float(p["max_stake"]), raw))
    step = float(p.get("rounding", .01))
    return round(round(bounded / step) * step, 2)

def idempotency_key(mandate_id: str, market: str, signal_epoch: int, direction: str) -> str:
    return hashlib.sha256(f"{mandate_id}|{market}|{signal_epoch}|{direction}".encode()).hexdigest()

@dataclass(frozen=True)
class Zone:
    kind: str; low: float; high: float; center: float; touches: int; rejections: int; breakouts: int; persistence: int; quality: float

def atr_like(prices: list[float], n: int = 20) -> float:
    diffs = [abs(b-a) for a,b in zip(prices, prices[1:])]
    return sum(diffs[-n:]) / max(1, len(diffs[-n:]))

def support_resistance(prices: Iterable[float], zigzag_pct=.0015, zone_width_atr=.35) -> list[Zone]:
    p = [float(x) for x in prices]
    if len(p) < 12: return []
    atr = max(atr_like(p), 1e-12); pivots=[]
    for i in range(2, len(p)-2):
        w=p[i-2:i+3]
        if p[i] == max(w): pivots.append((i,p[i],"RESISTANCE"))
        if p[i] == min(w): pivots.append((i,p[i],"SUPPORT"))
    zones=[]; width=atr*zone_width_atr
    for kind in ("SUPPORT","RESISTANCE"):
        group=[x for x in pivots if x[2]==kind]
        while group:
            seed=group.pop(0); cluster=[seed]; rest=[]
            for x in group: (cluster if abs(x[1]-seed[1]) <= width else rest).append(x)
            group=rest; center=sum(x[1] for x in cluster)/len(cluster); low=center-width; high=center+width
            touches=sum(1 for x in p if low <= x <= high)
            rejections=sum(1 for i in range(1,len(p)-1) if low <= p[i] <= high and ((kind=="SUPPORT" and p[i+1]>p[i]) or (kind=="RESISTANCE" and p[i+1]<p[i])))
            breakouts=sum(1 for x in p if (x < low-width if kind=="SUPPORT" else x > high+width))
            persistence=len(p)-cluster[-1][0]
            quality=max(0,min(1,.18*len(cluster)+.03*min(touches,8)+.04*min(rejections,6)-.04*min(breakouts,6)+.001*min(persistence,100)))
            zones.append(Zone(kind,low,high,center,touches,rejections,breakouts,persistence,round(quality,4)))
    return sorted(zones,key=lambda z:z.quality,reverse=True)

def sr_signal(prices: list[float], zones: list[Zone], min_quality=.55) -> str:
    if len(prices)<2:return "WAIT"
    prev,last=prices[-2],prices[-1]
    for z in zones:
        if z.quality<min_quality: continue
        if z.low<=prev<=z.high and z.kind=="SUPPORT" and last>prev:return "CALL"
        if z.low<=prev<=z.high and z.kind=="RESISTANCE" and last<prev:return "PUT"
    return "WAIT"

def market_score(features: dict, strategy_kind="REVERSAL") -> float:
    fit = features.get("range_persistence",0) if strategy_kind=="REVERSAL" else features.get("trend",0)
    return round(.30*fit+.25*features.get("structure_quality",0)+.15*features.get("volatility",0)+.15*features.get("payout",0)+.15*features.get("executability",0)-.25*features.get("anomaly_penalty",0),6)

def reconcile(platform_ids: set[str], ledger_ids: set[str], pending_keys: set[str]) -> dict:
    return {"platform_only":sorted(platform_ids-ledger_ids),"ledger_only":sorted(ledger_ids-platform_ids),"pending_idempotency":sorted(pending_keys),"ok":platform_ids==ledger_ids and not pending_keys}
