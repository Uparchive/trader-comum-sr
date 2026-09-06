"""Automatic Deriv market monitor for Kell Quant Lab.

Reads the current champion strategy, fetches recent public tick history,
calculates a simple SMA baseline signal, and NEVER places a trade while
execution_enabled is false. This is the observation phase before automated
DEMO execution is enabled.
"""

import asyncio
import json
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parents[2]
STRATEGY_PATH = ROOT / "config" / "production_strategy.json"
PUBLIC_WS = "wss://ws.binaryws.com/websockets/v3"


def load_strategy():
    return json.loads(STRATEGY_PATH.read_text(encoding="utf-8"))


def sma(values, n):
    return sum(values[-n:]) / n


async def main():
    strategy = load_strategy()
    symbol = strategy["market"]
    fast_n = int(strategy["fast_window"])
    slow_n = int(strategy["slow_window"])
    count = max(slow_n + 5, 30)

    async with websockets.connect(PUBLIC_WS, open_timeout=15) as ws:
        await ws.send(json.dumps({
            "ticks_history": symbol,
            "count": count,
            "end": "latest",
            "style": "ticks",
            "req_id": 1,
        }))

        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
            if msg.get("error"):
                raise RuntimeError(msg["error"].get("message", "market data error"))
            if msg.get("msg_type") == "history" or msg.get("history"):
                prices = [float(x) for x in msg.get("history", {}).get("prices", [])]
                if len(prices) < slow_n:
                    raise RuntimeError("Insufficient tick history")
                fast = sma(prices, fast_n)
                slow = sma(prices, slow_n)
                signal = "BUY" if fast > slow else "WAIT"
                print(f"Market: {symbol}")
                print(f"Fast SMA ({fast_n}): {fast:.5f}")
                print(f"Slow SMA ({slow_n}): {slow:.5f}")
                print(f"Baseline signal: {signal}")
                if not strategy.get("execution_enabled", False):
                    print("Execution: DISABLED (monitor-only safety mode)")
                    print("No order sent.")
                return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
