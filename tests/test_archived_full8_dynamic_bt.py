import json
import tempfile
import unittest
from pathlib import Path
from scripts.research_archived_full8_dynamic_gross_bt import load_hype_h1,ARCHIVED_STRATEGIES,ARCHIVED_LIMITS
from scripts.audit_archived_full8_dynamic_parity import evaluate


class ArchivedFull8ReplayTests(unittest.TestCase):
    def test_required_strategy_families_include_residual_not_zec(self):
        self.assertEqual(len(ARCHIVED_STRATEGIES),8)
        self.assertIn("RESIDUAL",ARCHIVED_STRATEGIES)
        self.assertNotIn("ZEC",ARCHIVED_STRATEGIES)
        self.assertLessEqual(ARCHIVED_LIMITS["IDLE"],0.25)

    def test_hype_h1_is_source_backed_sorted_and_duplicate_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/"hype.json"
            d={"hype":[{"t":2000,"o":2,"c":3},{"t":1000,"o":1,"c":2}]}
            p.write_text(json.dumps(d),encoding="utf8")
            observed=load_hype_h1(p)
            self.assertEqual(observed["times"],[1000,2000])
            d["hype"][1]["t"]=2000
            p.write_text(json.dumps(d),encoding="utf8")
            with self.assertRaisesRegex(ValueError,"DUPLICATE"):
                load_hype_h1(p)

    def test_native_gate_differences_are_explicit_and_never_live_certified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            test=root/"test";native=root/"native"
            test.mkdir();native.mkdir()
            def write(path,rows):
                path.write_text("".join(json.dumps(x)+"\n" for x in rows),encoding="utf8")
            write(test/"candidate-decisions.jsonl",[
                {"strategy_id":"IDLE","decision":"ACCEPTED_MODELED_ENTRY"},
                {"strategy_id":"RESIDUAL","decision":"ACCEPTED_MODELED_ENTRY"},
                {"strategy_id":"V12","decision":"ACCEPTED_MODELED_ENTRY","route":"R1"},
            ])
            write(test/"portfolio-trades.jsonl",[
                {"strategy_id":"V12","source_runtime_sha":"old"},
            ])
            write(native/"candidate-decisions.jsonl",[
                {"strategy_id":"IDLE","decision":"REJECTED_PORTFOLIO","reason":"IDLE:CORE_SIGNAL_OR_POSITION"},
                {"strategy_id":"RESIDUAL","decision":"REJECTED_PORTFOLIO","reason":"RESIDUAL:CORE_SIGNAL_OR_POSITION"},
                {"strategy_id":"V12","decision":"ACCEPTED_MODELED_ENTRY"},
            ])
            result=evaluate(test,native,"new")
            self.assertEqual(result["status"],"BLOCKED_FULL_LATEST_ORDER_GATE_PARITY")
            self.assertEqual(result["familyAcceptance"]["IDLE"]["difference"],1)
            self.assertEqual(result["v12TradesWrongSha"],1)
            self.assertFalse(result["automaticLiveActivationAuthorized"])


if __name__ == "__main__":
    unittest.main()
