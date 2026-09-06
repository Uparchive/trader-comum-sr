#!/usr/bin/env python3
"""Rebuild HOT/WARM/COLD indexes without deleting scientific evidence."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    # The materializer calculates temperature from current_date, rewrites recent
    # pages and year/month indexes, but never removes immutable run files.
    subprocess.run(["python", str(ROOT / "scripts/migrate_v2_to_v3.py")], cwd=ROOT, check=True)
    current = json.loads((ROOT / "state/current.json").read_text(encoding="utf-8"))
    print(f"Índices de retenção atualizados para {current['current_date']}; evidência preservada.")


if __name__ == "__main__": main()
