import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "ops" / "root" / "disdex-risk-api-final-preflight-20261028.py"
SPEC = importlib.util.spec_from_file_location("disdex_risk_api_final_preflight_multisha", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def manifest():
    prefixes = {
        "V12_V4": "disdex-v12-v4",
        "PENGU_V8": "disdex-pengu-dual-ls-v2",
        "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1",
        "V52": "disdex-v52-aster-only",
        "FET_BRK48_RESIDUAL": "disdex-fet-brk48",
        "HYPE_TREND_LONG": "disdex-hype-long",
        "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short",
        "SHARED_CRYPTO_RISK": "disdex-shared-crypto-risk",
        "MARGIN_GUARD": "disdex-v12-v52-margin-guard",
    }
    owners = {
        "V12_V4": "V4_PRIMARY",
        "PENGU_V8": "PENGU_V8",
        "QUALITY102_CAUSAL_V1": "Q102_PRIMARY",
        "V52": "V52",
        "FET_BRK48_RESIDUAL": "FET_BRK48_RESIDUAL",
        "HYPE_TREND_LONG": "HYPE_TREND_LONG",
        "IDLE_PRIORITY_SHORT": "IDLE_PRIORITY_SHORT",
        "SHARED_CRYPTO_RISK": "SHARED_RISK",
        "MARGIN_GUARD": "MARGIN_GUARD",
    }
    runners = {}
    for index, runner_id in enumerate(prefixes):
        sha = f"{index + 1:040x}"
        runners[runner_id] = {
            "sha": sha,
            "releaseRoot": f"/home/deploy/disdex-trading/releases/{sha}",
            "serviceUnit": f"{prefixes[runner_id]}@{sha}.service",
            "evidenceMode": "legacy" if runner_id in {"PENGU_V8", "FET_BRK48_RESIDUAL", "HYPE_TREND_LONG", "IDLE_PRIORITY_SHORT"} else "tick-v1",
            "stopOwner": owners[runner_id],
        }
    return {"schema": "disdex-runner-pin-manifest/v1", "target": "fixture", "runners": runners}


class RiskApiFinalPreflightMultiShaTests(unittest.TestCase):
    def test_explicit_runner_map_has_independent_services_and_no_common_substitution(self):
        pins = manifest()
        self.assertEqual(MODULE.validate_runner_pin_manifest(pins), [])
        services = MODULE.services_for_runner_pins(pins)
        self.assertEqual(services["PENGU"], pins["runners"]["PENGU_V8"]["serviceUnit"])
        self.assertEqual(services["FET"], pins["runners"]["FET_BRK48_RESIDUAL"]["serviceUnit"])
        self.assertEqual(services["HYPE"], pins["runners"]["HYPE_TREND_LONG"]["serviceUnit"])
        self.assertEqual(services["IDLE"], pins["runners"]["IDLE_PRIORITY_SHORT"]["serviceUnit"])
        self.assertEqual(services["RISK"], pins["runners"]["SHARED_CRYPTO_RISK"]["serviceUnit"])

    def test_invalid_pin_map_blocks_service_derivation(self):
        pins = manifest()
        pins["runners"]["Q102_PRIMARY"] = pins["runners"].pop("QUALITY102_CAUSAL_V1")
        self.assertTrue(MODULE.validate_runner_pin_manifest(pins))

        pins = manifest()
        pins["runners"]["PENGU_V8"]["serviceUnit"] = pins["runners"]["V12_V4"]["serviceUnit"]
        self.assertIn("PENGU_V8_SERVICE_UNIT_SHA_MISMATCH", MODULE.validate_runner_pin_manifest(pins))

        pins = manifest()
        pins["runners"]["FET_BRK48_RESIDUAL"]["releaseRoot"] = "/tmp/unrelated-release"
        self.assertIn("FET_BRK48_RESIDUAL_RELEASE_ROOT_SHA_MISMATCH", MODULE.validate_runner_pin_manifest(pins))

        pins = manifest()
        self.assertIn(
            "RUNNER_PIN_MANIFEST_INVALID",
            MODULE.validate_risk_and_protection({}, {}, {}, 1_800_000_000_000, {}),
        )

    def test_risk_and_stop_validation_uses_the_supplied_pin_map(self):
        now = 1_800_000_000_000
        pins = manifest()
        v4_sha = pins["runners"]["V12_V4"]["sha"]
        v4 = {
            "status": "HEALTHY",
            "effectiveUnprotectedCount": 0,
            "readOnly": True,
            "checkedAt": now,
            "v4Sha": v4_sha,
            "serviceUnit": pins["runners"]["V12_V4"]["serviceUnit"],
            "originalUnprotectedCount": 0,
            "v4Verified": [],
            "unresolved": [],
        }
        risk = {
            "sourceComplete": True,
            "tripped": False,
            "maximumLossPct": 7.5,
            "updatedAt": now,
            "utcDay": "2027-01-15",
            "accountScope": "ASTER_FUTURES",
        }
        old = {"ok": True, "readOnly": True, "unprotectedCount": 0}
        self.assertEqual(MODULE.validate_risk_and_protection(risk, v4, old, now, pins), [])
        self.assertIn(
            "V4_STOP_COMPANION_SHA_MISMATCH",
            MODULE.validate_risk_and_protection(risk, {**v4, "v4Sha": "f" * 40}, old, now, pins),
        )
        self.assertIn(
            "V4_STOP_COMPANION_SERVICE_MISMATCH",
            MODULE.validate_risk_and_protection(risk, {**v4, "serviceUnit": "old.service"}, old, now, pins),
        )
        self.assertIn(
            "RISK_UTC_DAY_MISMATCH",
            MODULE.validate_risk_and_protection({**risk, "utcDay": "2027-01-14"}, v4, old, now, pins),
        )


if __name__ == "__main__":
    unittest.main()
