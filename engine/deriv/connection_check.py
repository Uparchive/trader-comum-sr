"""Kell Quant Lab — Deriv Demo connectivity check.

This module is intentionally read-only: it verifies that the configured
credential can reach the Deriv API. It does not place, buy, sell or modify
any contract.
"""

import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://api.derivws.com/trading/v1/options/accounts"


def main() -> int:
    token = os.getenv("DERIV_TOKEN")
    app_id = os.getenv("DERIV_APP_ID")

    if not token:
        print("ERROR: DERIV_TOKEN secret is not configured.")
        return 2

    if not app_id:
        print("WAITING: DERIV_APP_ID is not configured yet.")
        print("Token is present, but the App ID is also required for the authenticated API flow.")
        return 3

    request = urllib.request.Request(
        API_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Deriv-App-ID": app_id,
            "Accept": "application/json",
            "User-Agent": "kell-quant-lab/0.1",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
            print(f"Deriv API responded successfully (HTTP {response.status}).")
            # Never print token, auth headers or full account payload.
            if isinstance(payload, dict):
                print("Authenticated response received safely.")
            return 0
    except urllib.error.HTTPError as exc:
        print(f"Deriv API authentication/connectivity check failed (HTTP {exc.code}).")
        return 1
    except Exception as exc:
        print(f"Deriv API connectivity check failed: {type(exc).__name__}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
