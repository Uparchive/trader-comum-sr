"""One-shot Deriv Options DEMO trade test.

Hard safety rule: the WebSocket URL returned by Deriv must be the /ws/demo
endpoint. The script aborts before sending a buy if it is anything else.
"""
import asyncio, json, os, sys, urllib.request

API = "https://api.derivws.com"
SYMBOL = "1HZ100V"
STAKE = 1.0
MULTIPLIER = 40


def rest_json(url, method="GET"):
    req = urllib.request.Request(url, method=method, headers={
        "Authorization": f"Bearer {os.environ['DERIV_TOKEN']}",
        "Deriv-App-ID": os.environ["DERIV_APP_ID"],
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def extract_accounts(payload):
    data = payload.get("data", payload)
    if isinstance(data, list): return data
    if isinstance(data, dict):
        for key in ("accounts", "items", "data"):
            if isinstance(data.get(key), list): return data[key]
    return []


def account_id(a):
    return a.get("account_id") or a.get("id") or a.get("loginid")


def is_demo(a):
    text = json.dumps(a).lower()
    return "demo" in text or "virtual" in text


async def main():
    if not os.getenv("DERIV_TOKEN") or not os.getenv("DERIV_APP_ID"):
        raise SystemExit("Missing DERIV_TOKEN or DERIV_APP_ID")

    accounts_payload = rest_json(f"{API}/trading/v1/options/accounts")
    accounts = extract_accounts(accounts_payload)
    demos = [a for a in accounts if is_demo(a) and account_id(a)]
    if not demos:
        print("ERROR: No Options DEMO account found. No trade sent.")
        return 2

    aid = account_id(demos[0])
    otp_payload = rest_json(f"{API}/trading/v1/options/accounts/{aid}/otp", "POST")
    data = otp_payload.get("data", {})
    ws_url = data.get("url") if isinstance(data, dict) else None
    if not ws_url or "/trading/v1/options/ws/demo?" not in ws_url:
        print("SAFETY ABORT: Deriv did not return a DEMO WebSocket URL. No trade sent.")
        return 3

    import websockets
    async with websockets.connect(ws_url, open_timeout=15) as ws:
        proposal = {
            "proposal": 1, "amount": STAKE, "basis": "stake",
            "contract_type": "MULTUP", "currency": "USD",
            "duration_unit": "s", "multiplier": MULTIPLIER,
            "underlying_symbol": SYMBOL, "req_id": 101
        }
        await ws.send(json.dumps(proposal))
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), 20))
            if msg.get("error"):
                print("Proposal rejected:", msg["error"].get("message", "unknown error"))
                return 4
            if msg.get("msg_type") == "proposal" or msg.get("proposal"):
                p = msg.get("proposal", {})
                pid = p.get("id")
                ask = p.get("ask_price")
                if not pid or ask is None:
                    print("ERROR: Proposal response incomplete. No trade sent.")
                    return 5
                break

        await ws.send(json.dumps({"buy": pid, "price": float(ask), "req_id": 102}))
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), 20))
            if msg.get("error"):
                print("DEMO buy rejected:", msg["error"].get("message", "unknown error"))
                return 6
            if msg.get("msg_type") == "buy" or msg.get("buy"):
                buy = msg.get("buy", {})
                print("SUCCESS: one DEMO test trade was sent and accepted.")
                print("Environment: DEMO only")
                print("Symbol:", SYMBOL)
                print("Stake: USD", STAKE)
                print("Multiplier:", MULTIPLIER)
                print("Contract id:", buy.get("contract_id", "received"))
                return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
