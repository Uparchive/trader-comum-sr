"""Kell Quant Lab automatic executor — Deriv Options DEMO only.

Fail-closed design: no order can be sent unless the strategy is CHAMPION,
research_approved and execution_enabled, risk limits are valid, the selected
Options account explicitly reports account_type=demo, and the OTP URL parses
to the exact Deriv DEMO WebSocket endpoint.
"""

import asyncio, json, os, sys, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import websockets

ROOT = Path(__file__).resolve().parents[2]
STRATEGY_PATH = ROOT / "config" / "production_strategy.json"
RISK_PATH = ROOT / "config" / "risk_limits.json"
STATE_PATH = ROOT / "data" / "runtime_state.json"
STATUS_PATH = ROOT / "data" / "status.json"
API = "https://api.derivws.com"
PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public"

def read_json(path): return json.loads(path.read_text(encoding="utf-8"))
def write_json(path, payload): path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
def now_utc(): return datetime.now(timezone.utc)

def rest_json(url, method="GET"):
    token, app_id = os.environ.get("DERIV_TOKEN"), os.environ.get("DERIV_APP_ID")
    if not token or not app_id: raise RuntimeError("Deriv secrets unavailable")
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"Bearer {token}", "Deriv-App-ID": app_id, "Accept": "application/json", "User-Agent": "kell-quant-lab/0.2"})
    with urllib.request.urlopen(req, timeout=20) as response: return json.loads(response.read().decode("utf-8"))

def extract_accounts(payload):
    data = payload.get("data", payload)
    if isinstance(data, list): return data
    if isinstance(data, dict):
        for key in ("accounts", "items", "data"):
            if isinstance(data.get(key), list): return data[key]
        if data.get("account_id"): return [data]
    return []

def exact_demo_account(accounts):
    demos = [a for a in accounts if str(a.get("account_type", "")).lower() == "demo" and a.get("account_id")]
    if not demos: raise RuntimeError("No explicit Options demo account found")
    return demos[0]

def validate_demo_ws_url(url):
    if not url: raise RuntimeError("Missing OTP WebSocket URL")
    p = urlparse(url)
    if p.scheme != "wss" or p.hostname != "api.derivws.com": raise RuntimeError("Unexpected WebSocket host")
    if p.path != "/trading/v1/options/ws/demo": raise RuntimeError("SAFETY ABORT: endpoint is not exact DEMO path")
    if not parse_qs(p.query).get("otp"): raise RuntimeError("Missing OTP in DEMO URL")
    return url

def validate_gate(strategy, risk):
    if risk.get("environment") != "DEMO_ONLY" or risk.get("real_money_allowed") is not False or risk.get("fail_closed") is not True: raise RuntimeError("Risk configuration is not fail-closed DEMO_ONLY")
    if strategy.get("status") != "CHAMPION": return False, "Strategy is not CHAMPION"
    if not strategy.get("research_approved", False): return False, "Research approval is still locked"
    if not strategy.get("execution_enabled", False): return False, "Automatic execution is disabled"
    stake = float(strategy.get("stake_usd", 0))
    if stake <= 0 or stake > float(risk["max_stake_usd"]): raise RuntimeError("Stake violates configured risk limit")
    return True, "Execution gate open"

def reset_daily_state(state, today):
    if state.get("date") != today:
        state["date"], state["trades_today"], state["daily_realized_pnl"] = today, 0, 0.0
    return state

def risk_allows_new_trade(state, risk, open_positions):
    if len(open_positions) >= int(risk["max_open_positions"]): return False, "Open-position limit reached"
    if int(state.get("trades_today", 0)) >= int(risk["max_trades_per_day"]): return False, "Daily trade limit reached"
    if float(state.get("daily_realized_pnl", 0)) <= -abs(float(risk["max_daily_loss_usd"])): return False, "Daily loss lock active"
    last = state.get("last_trade_at")
    if last and now_utc() - datetime.fromisoformat(last.replace("Z", "+00:00")) < timedelta(minutes=int(risk["cooldown_minutes"])): return False, "Cooldown active"
    return True, "Risk checks passed"

async def request(ws, payload, expected, timeout=20):
    await ws.send(json.dumps(payload))
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if msg.get("error"): raise RuntimeError(msg["error"].get("message", "Deriv WebSocket error"))
        if msg.get("msg_type") == expected or expected in msg: return msg

async def market_signal(strategy):
    slow_n, fast_n = int(strategy["slow_window"]), int(strategy["fast_window"])
    async with websockets.connect(PUBLIC_WS, open_timeout=15) as ws:
        msg = await request(ws, {"ticks_history": strategy["market"], "count": max(slow_n + 5, 30), "end": "latest", "style": "ticks", "req_id": 1}, "history")
    prices = [float(x) for x in msg.get("history", {}).get("prices", [])]
    if len(prices) < slow_n: raise RuntimeError("Insufficient market history")
    fast, slow = sum(prices[-fast_n:]) / fast_n, sum(prices[-slow_n:]) / slow_n
    return ("BUY" if fast > slow else "WAIT"), fast, slow

def authenticated_demo_url():
    account = exact_demo_account(extract_accounts(rest_json(f"{API}/trading/v1/options/accounts")))
    payload = rest_json(f"{API}/trading/v1/options/accounts/{account['account_id']}/otp", "POST")
    data = payload.get("data", {})
    return validate_demo_ws_url(data.get("url") if isinstance(data, dict) else None)

async def reconcile_tracked(ws, state):
    remaining = []
    for item in state.get("tracked_contracts", []):
        cid = item.get("contract_id")
        if not cid: continue
        msg = await request(ws, {"proposal_open_contract": 1, "contract_id": cid, "req_id": 200}, "proposal_open_contract")
        contract = msg.get("proposal_open_contract", {})
        if contract.get("is_sold") or contract.get("is_expired"):
            profit = float(contract.get("profit") or 0.0)
            state["daily_realized_pnl"] = round(float(state.get("daily_realized_pnl", 0)) + profit, 2)
            state["total_realized_pnl"] = round(float(state.get("total_realized_pnl", 0)) + profit, 2)
            if profit > 0: state["wins"] = int(state.get("wins", 0)) + 1
            elif profit < 0: state["losses"] = int(state.get("losses", 0)) + 1
            peak = max(float(state.get("peak_realized_pnl", 0)), float(state["total_realized_pnl"]))
            state["peak_realized_pnl"] = round(peak, 2)
            state["max_drawdown"] = round(max(float(state.get("max_drawdown", 0)), max(0.0, peak - float(state["total_realized_pnl"]))), 2)
        else: remaining.append(item)
    state["tracked_contracts"] = remaining

async def get_portfolio(ws):
    msg = await request(ws, {"portfolio": 1, "req_id": 201}, "portfolio")
    return msg.get("portfolio", {}).get("contracts", []) or []

async def buy_demo(ws, strategy):
    proposal = {"proposal": 1, "amount": float(strategy["stake_usd"]), "basis": "stake", "contract_type": strategy["contract_type"], "currency": strategy.get("currency", "USD"), "duration_unit": "s", "multiplier": int(strategy["multiplier"]), "underlying_symbol": strategy["market"], "limit_order": {"stop_loss": float(strategy["stop_loss_usd"]), "take_profit": float(strategy["take_profit_usd"])}, "req_id": 300}
    p = (await request(ws, proposal, "proposal")).get("proposal", {})
    if not p.get("id") or p.get("ask_price") is None: raise RuntimeError("Incomplete proposal; no order sent")
    buy = (await request(ws, {"buy": p["id"], "price": float(p["ask_price"]), "req_id": 301}, "buy")).get("buy", {})
    if not buy.get("contract_id"): raise RuntimeError("Buy response missing contract id")
    return buy["contract_id"]

def update_dashboard(status, strategy, state, signal, note, mode):
    wins, losses = int(state.get("wins", 0)), int(state.get("losses", 0)); settled = wins + losses
    stamp = now_utc().isoformat().replace("+00:00", "Z")
    status["system_status"], status["now_summary"] = "Laboratório online", note
    status["strategy"] = {"name": strategy.get("name", "—"), "version": strategy.get("version", "—"), "market": f"{strategy.get('market', '—')} — Deriv Demo", "status": "Execução Demo autorizada" if mode == "ACTIVE" else "Aguardando validação do laboratório"}
    status["signal"] = {"state": signal, "note": note}
    status["performance"] = {"pnl": f"{float(state.get('total_realized_pnl', 0)):.2f}", "trades": int(state.get("total_trades", 0)), "win_rate": f"{(wins / settled * 100):.1f}%" if settled else "—", "drawdown": f"{float(state.get('max_drawdown', 0)):.2f}"}
    status.setdefault("research", {"date": "—", "title": "—", "summary": "—", "decision": "—"}); status.setdefault("experiment", {})
    status["experiment"]["executor_status"], status["experiment"]["updated_at"] = ("Ativo — somente Demo" if mode == "ACTIVE" else "Pronto — bloqueado até aprovação"), stamp
    activity = status.get("activity", []); activity.insert(0, {"time": stamp, "message": note}); status["activity"] = activity[:8]

async def main():
    strategy, risk, state, status = read_json(STRATEGY_PATH), read_json(RISK_PATH), read_json(STATE_PATH), read_json(STATUS_PATH)
    state = reset_daily_state(state, now_utc().date().isoformat())
    gate_open, gate_reason = validate_gate(strategy, risk)
    signal, fast, slow = await market_signal(strategy); print(f"Signal={signal}; fast={fast:.5f}; slow={slow:.5f}")
    if not gate_open:
        note = f"Robô pronto, mas bloqueado: {gate_reason}. Sinal atual: {signal}."
        update_dashboard(status, strategy, state, signal, note, "LOCKED"); write_json(STATE_PATH, state); write_json(STATUS_PATH, status); print(note); return 0
    ws_url = authenticated_demo_url()
    async with websockets.connect(ws_url, open_timeout=15) as ws:
        await reconcile_tracked(ws, state); portfolio = await get_portfolio(ws); allowed, reason = risk_allows_new_trade(state, risk, portfolio)
        if signal != "BUY": note = "Robô Demo ativo. Nenhuma condição de entrada agora."
        elif not allowed: note = f"Robô Demo ativo, mas não operou: {reason}."
        else:
            cid = await buy_demo(ws, strategy); stamp = now_utc().isoformat().replace("+00:00", "Z")
            state["trades_today"] = int(state.get("trades_today", 0)) + 1; state["total_trades"] = int(state.get("total_trades", 0)) + 1; state["last_trade_at"] = stamp
            state.setdefault("tracked_contracts", []).append({"contract_id": cid, "opened_at": stamp, "strategy": strategy.get("name"), "version": strategy.get("version"), "market": strategy.get("market")})
            note = "Ordem automática aceita na Deriv Demo. Resultado será reconciliado nos próximos ciclos."; print("DEMO order accepted. Contract id recorded locally.")
    update_dashboard(status, strategy, state, signal, note, "ACTIVE"); write_json(STATE_PATH, state); write_json(STATUS_PATH, status); return 0

if __name__ == "__main__":
    try: sys.exit(asyncio.run(main()))
    except Exception as exc: print(f"FAIL-CLOSED: {type(exc).__name__}: {exc}"); sys.exit(1)
