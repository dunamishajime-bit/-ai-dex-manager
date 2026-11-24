import json
import pathlib
import unittest
from unittest.mock import patch

import scripts.ops.deploy.disdex_stable4_dd30_monitor_cutover as cutover

PIN_SHA = "a" * 40
TARGET_SHA = "b" * 40
PIN_UNIT = "disdex-shared-crypto-risk@" + PIN_SHA + ".service"
TARGET_UNIT = "disdex-shared-crypto-risk@" + TARGET_SHA + ".service"


def pins_raw():
    return json.dumps({"runners": {"SHARED_CRYPTO_RISK": {
        "sha": PIN_SHA, "serviceUnit": PIN_UNIT,
    }}}).encode()


class SharedWriterSingletonTest(unittest.TestCase):
    def test_pinned_identity_rejects_wrong_service_and_sha(self):
        self.assertEqual(cutover.pinned_shared_risk_unit(pins_raw()), PIN_UNIT)
        with self.assertRaisesRegex(cutover.ContractError, "SHARED_RISK_PIN_UNIT_INVALID"):
            cutover.pinned_shared_risk_unit(json.dumps({"runners": {"SHARED_CRYPTO_RISK": {
                "sha": PIN_SHA, "serviceUnit": TARGET_UNIT,
            }}}).encode())

    def test_unit_listing_parses_only_sha_scoped_risk_writers(self):
        listing = (
            "● " + TARGET_UNIT + " loaded active running duplicate\n"
            "  " + PIN_UNIT + " loaded active running canonical\n"
            "  disdex-shared-crypto-risk@.service loaded active running template\n"
            "  untrusted@ffffffffffffffffffffffffffffffffffffffff.service loaded active running unrelated\n"
        )
        with patch.object(cutover, "run", return_value=listing):
            self.assertEqual(cutover.shared_risk_units(), sorted([PIN_UNIT, TARGET_UNIT]))

    def test_duplicate_active_is_fail_closed_even_if_disabled(self):
        def props(unit, key):
            if key == "ActiveState": return "active"
            if key == "UnitFileState": return "disabled"
            return "333"
        with patch.object(cutover, "unit_active", return_value=True), \
             patch.object(cutover, "shared_risk_units", return_value=[PIN_UNIT, TARGET_UNIT]), \
             patch.object(cutover, "unit_property", side_effect=props):
            with self.assertRaisesRegex(cutover.ContractError, "MULTIPLE_SHARED_RISK_WRITERS"):
                cutover.assert_single_shared_risk_writer(pins_raw())

    def test_masked_target_and_single_pinned_pass(self):
        def props(unit, key):
            return {"ActiveState": "inactive", "UnitFileState": "masked", "MainPID": "0"}[key]
        with patch.object(cutover, "unit_active", return_value=True), \
             patch.object(cutover, "shared_risk_units", return_value=[PIN_UNIT, TARGET_UNIT]), \
             patch.object(cutover, "unit_property", side_effect=props):
            self.assertEqual(cutover.assert_single_shared_risk_writer(pins_raw(), target=TARGET_SHA), PIN_UNIT)

    def test_retire_only_non_pinned_and_mask_disabled_candidate(self):
        states = {PIN_UNIT: "active", TARGET_UNIT: "active"}
        masks = set()
        stopped = []
        def props(unit, key):
            if key == "ActiveState": return states[unit]
            if key == "UnitFileState": return "masked" if unit in masks else "disabled"
            if key == "MainPID": return "0" if unit in masks else "123"
            raise AssertionError(key)
        def stop(unit):
            stopped.append(unit); states[unit] = "inactive"
        def command(*args, **_kwargs):
            self.assertEqual(args[0:2], ("/usr/bin/systemctl", "mask"))
            masks.add(args[2])
            return ""
        with patch.object(cutover, "shared_risk_units", return_value=[PIN_UNIT, TARGET_UNIT]), \
             patch.object(cutover, "unit_property", side_effect=props), \
             patch.object(cutover, "stop_unit", side_effect=stop), \
             patch.object(cutover, "run", side_effect=command):
            self.assertEqual(cutover.retire_non_pinned_shared_risk_writers(pins_raw(), TARGET_SHA), [TARGET_UNIT])
        self.assertEqual(stopped, [TARGET_UNIT])
        self.assertEqual(masks, {TARGET_UNIT})
        self.assertEqual(states[PIN_UNIT], "active")

    def test_cutover_uses_guard_before_new_runners(self):
        source = pathlib.Path(cutover.__file__).read_text(encoding="utf8")
        self.assertLess(source.index("shared_risk_retired = retire_non_pinned_shared_risk_writers"),
                        source.index("for runner, unit in units.items():\n            validate_target_unit(unit, target, runner)\n            run("))
        self.assertIn("assert_single_shared_risk_writer(read_regular(PINS, 131_072), target=target)", source)


if __name__ == "__main__":
    unittest.main()
