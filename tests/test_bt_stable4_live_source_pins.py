import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "research" / "audit_bt_stable4_live_source_pins.py"
spec = importlib.util.spec_from_file_location("bt_pin_audit", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

SHA_A = "a" * 40
SHA_B = "b" * 40


def fixtures():
    names = mod.TRADING_MODELS | {"SharedRisk"}
    live = {
        "schema": "disdex-bt-vps-entrypoint-parity/v1",
        "all_entrypoints_verified": True,
        "observed_utc": "2026-11-18T22:04:41+00:00",
        "rows": [{"runner": n, "git_commit": SHA_A, "verified": True} for n in sorted(names)],
    }
    def scenario():
        return {
            "modeled_exits": len(mod.TRADING_MODELS),
            "source_models": {
                name: {"modeled_exits": 1, "source_identifiers": [{"sha": SHA_A, "trades": 1}]}
                for name in mod.TRADING_MODELS
            },
        }
    study = {
        "schema": "disdex-bt-stable4-research-source-audit/v1",
        "scenarios": {"10": scenario(), "30": scenario()},
    }
    return study, live


class SourcePinAuditTests(unittest.TestCase):
    def test_full_source_match_still_not_certified(self):
        s, l = fixtures()
        report = mod.compare(s, l)
        self.assertFalse(report["research_to_current_production_backtest_certified"])
        self.assertFalse(report["shared_risk_applied_to_research_replay_verified"])
        self.assertEqual(report["scenarios"]["10"]["sha_mismatched_modeled_exits"], 0)

    def test_v4_mismatch_counted_in_both_scenarios(self):
        s, l = fixtures()
        for case in s["scenarios"].values():
            case["source_models"]["V4"]["source_identifiers"][0]["sha"] = SHA_B
        report = mod.compare(s, l)
        self.assertEqual(report["scenarios"]["10"]["sha_mismatched_modeled_exits"], 1)
        self.assertEqual(report["scenarios"]["30"]["sha_mismatched_modeled_exits"], 1)

    def test_missing_study_runner_fails_closed(self):
        s, l = fixtures()
        del s["scenarios"]["10"]["source_models"]["HYPE"]
        with self.assertRaisesRegex(ValueError, "categories"):
            mod.compare(s, l)

    def test_uncertified_vps_report_rejected(self):
        s, l = fixtures()
        l["all_entrypoints_verified"] = False
        with self.assertRaisesRegex(ValueError, "incomplete"):
            mod.compare(s, l)

    def test_trade_count_mismatch_rejected(self):
        s, l = fixtures()
        s["scenarios"]["10"]["modeled_exits"] += 1
        with self.assertRaisesRegex(ValueError, "total"):
            mod.compare(s, l)


if __name__ == "__main__":
    unittest.main()
