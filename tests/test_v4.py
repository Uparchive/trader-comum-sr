import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/"engine"/"v4"))
from core import *
class V4(unittest.TestCase):
 def setUp(self):
  self.g=json.loads((ROOT/"config/v4/platform_governance.json").read_text());self.m=json.loads((ROOT/"config/v4/active_mandate.json").read_text());self.s=json.loads((ROOT/"config/v4/strategy_registry.json").read_text());self.p=json.loads((ROOT/"config/v4/capital_policy_registry.json").read_text())["policies"][0]
 def test_demo_only(self): validate_demo_only(self.g);self.assertFalse(any("REAL" in x for x in self.g["real_endpoint_paths"]))
 def test_mandate(self): validate_mandate(self.m,self.g)
 def test_no_champion_uses_baseline(self): self.assertEqual(select_incumbent(self.s),"BASELINE-SR-v1");self.assertEqual(executor_state("PLATFORM_OK",True),"WAITING_SIGNAL")
 def test_platform_rejected(self): self.assertEqual(executor_state("PLATFORM_REJECTED",True),"PLATFORM_REJECTED")
 def test_capital_uses_balance(self): self.assertEqual(capital_size(10000,self.p),1.0);self.assertEqual(capital_size(500,self.p),.35)
 def test_idempotency(self): self.assertEqual(idempotency_key("m","x",1,"CALL"),idempotency_key("m","x",1,"CALL"));self.assertNotEqual(idempotency_key("m","x",1,"CALL"),idempotency_key("m","x",2,"CALL"))
 def test_sr_quantified(self):
  p=[100,101,100,99,100,101,100,99,100,101,100,99,100,101,100,99,100,101,100,99,100,101,100,99,100,101,100,99,100,101]
  z=support_resistance(p);self.assertTrue(z);self.assertTrue(all(x.touches>=1 and 0<=x.quality<=1 for x in z))
 def test_scanner_fit(self): self.assertGreater(market_score({"range_persistence":1,"structure_quality":1,"volatility":.5,"payout":.8,"executability":1}),market_score({"range_persistence":0,"structure_quality":.2,"volatility":.5,"payout":.8,"executability":1}))
 def test_reconciliation(self): self.assertTrue(reconcile({"1"},{"1"},set())["ok"]);self.assertFalse(reconcile({"1"},set(),set())["ok"])
 def test_champion_switch_requires_mandate(self):
  registry={**self.s,"champion":"S0001-v1"};self.assertEqual(select_incumbent(registry),"S0001-v1");self.assertEqual(self.m["strategy_version"],"BASELINE-SR-v1")
 def test_cycle_continuity(self):
  for cycle in ("C","A","B","C"):self.assertIn(executor_state("PLATFORM_OK",True),RUN_STATES)
if __name__=="__main__":unittest.main()
