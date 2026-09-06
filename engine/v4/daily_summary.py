#!/usr/bin/env python3
import json, sys
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def main(path,output):
    events=[json.loads(x) for x in Path(path).read_text(encoding="utf-8").splitlines() if x.strip()]
    settled=[x for x in events if x.get("event_type")=="TRADE_SETTLED"]
    pnl=sum(float(x.get("pnl",0)) for x in settled); balances=[x.get("balance_after") for x in settled if x.get("balance_after") is not None]
    peaks=[];peak=None;dd=0
    for b in balances: peak=b if peak is None else max(peak,b);dd=max(dd,peak-b);peaks.append(peak)
    out={"opening_balance":events[0].get("balance_before") if events else None,"closing_balance":balances[-1] if balances else None,"pnl":round(pnl,2),"return":None,"trades":len(settled),"wins":sum(x.get("pnl",0)>0 for x in settled),"losses":sum(x.get("pnl",0)<0 for x in settled),"drawdown":round(dd,2),"markets":sorted({x.get("market") for x in settled if x.get("market")}),"strategies":sorted({x.get("strategy_version") for x in settled if x.get("strategy_version")}),"capital_policies":sorted({x.get("capital_policy_version") for x in settled if x.get("capital_policy_version")}),"execution_issues":dict(Counter(x.get("error") for x in events if x.get("error")))}
    if out["opening_balance"]:out["return"]=round(pnl/out["opening_balance"],8)
    Path(output).write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
if __name__=="__main__":main(sys.argv[1],sys.argv[2])
