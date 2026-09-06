#!/usr/bin/env python3
"""V4 materializer: validates pointers and hashes mandates.

The canonical evidence projection is owned by engine/project_status.py. This
legacy materializer must not overwrite indexes/evidence/recent.json, otherwise
newer canonical research-cycle evidence is discarded during integrity checks.
"""
import json, sys
from pathlib import Path
from core import canonical_hash, validate_mandate

ROOT=Path(__file__).resolve().parents[2]
def load(p): return json.loads((ROOT/p).read_text(encoding="utf-8"))
def save(p,v):
    q=ROOT/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(v,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

def main():
    mandate=load("config/v4/active_mandate.json"); governance=load("config/v4/platform_governance.json")
    mandate["hash"]=canonical_hash(mandate); validate_mandate(mandate,governance); save("config/v4/active_mandate.json",mandate)
    evidence=[]
    for path in sorted((ROOT/"evidence").glob("**/*.json"),reverse=True):
        d=json.loads(path.read_text(encoding="utf-8")); evidence.append({k:d.get(k) for k in ("evidence_id","title","date","cycle","market","strategy","hypothesis","decision","capital_policy","platform")}|{"path":str(path.relative_to(ROOT))})
    current=load("state/current.json")
    if int(current.get("schema_version",0))>=4:
        current["active_mandate"]={"mandate_id":mandate["mandate_id"],"path":"config/v4/active_mandate.json","hash":mandate["hash"]}
        current["latest_evidence"]=[x["path"] for x in evidence[:5]]; save("state/current.json",current)
    print("V4 materialized")
if __name__=="__main__": sys.exit(main())
