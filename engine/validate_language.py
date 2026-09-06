#!/usr/bin/env python3
"""Falha o CI quando a camada visível volta a ser predominantemente inglesa."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

PT = [" de ", " da ", " do ", " das ", " dos ", " para ", " com ", " sem ", " não ", " uma ", " um ", " que ", " ainda ", " antes ", " evidência", " hipótese", " dados", " mercado", " validação", " próximo", " passo"]
EN = [" the ", " and ", " with ", " without ", " before ", " after ", " evidence", " hypothesis", " data ", " market ", " validation", " next ", " step ", " is ", " are ", " was ", " were ", " not "]
BANNED_UI = [
    "QUANTITATIVE RESEARCH PLATFORM",
    "DEMO ONLY",
    "Source of Truth",
    "MARKET DISCOVERY ENGINE",
    "HYPOTHESIS REGISTRY",
    "EXPERIMENT ENGINE",
    "RESEARCH LEDGER",
    "SCIENTIFIC GOVERNANCE",
    ">Hypothesis<",
    ">Audit<",
]


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def english_dominates(text):
    s = f" {str(text).lower()} "
    pt = sum(s.count(x) for x in PT)
    en = sum(s.count(x) for x in EN)
    return en >= 3 and en > pt


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for phrase in BANNED_UI:
        if phrase in html:
            raise SystemExit(f"Idioma visível inválido no index.html: {phrase}")

    research = load(DATA / "research.json")
    fields = ("title", "question", "method", "evidence", "limitations", "audit", "next_step", "summary")
    for day in research.get("days", []):
        for entry in day.get("entries", []):
            combined = " ".join(str(entry.get(k, "")) for k in fields)
            if english_dominates(combined):
                raise SystemExit(f"Narrativa predominantemente inglesa em Dia {day.get('day')}{entry.get('subcycle')}")

    status = load(DATA / "status.json")
    visible = " ".join([
        str(status.get("system_status", "")),
        str(status.get("now_summary", "")),
        str(status.get("research", {}).get("title", "")),
        str(status.get("research", {}).get("summary", "")),
        str(status.get("pipeline", {}).get("next_step", "")),
    ])
    if english_dominates(visible):
        raise SystemExit("Narrativa visível do status está predominantemente em inglês")

    print("Idioma visível: pt-BR OK")


if __name__ == "__main__":
    main()
