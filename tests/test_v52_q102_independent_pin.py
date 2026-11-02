import unittest

from scripts.v52_q102_independent_pin import validate_q102_identity, validate_peer_identity

Q = "e" * 40
V = "d" * 40

def manifest():
    return {"schema": "disdex-runner-pin-manifest/v1", "target": "professional-dismanager.net",
            "runners": {"QUALITY102_CAUSAL_V1": {"sha": Q,
                "releaseRoot": "/home/deploy/disdex-trading/releases/" + Q,
                "serviceUnit": "disdex-quality102-causal-v1@" + Q + ".service"}}}


class IndependentPinTest(unittest.TestCase):
    def valid(self):
        return dict(manifest=manifest(), manifest_uid=0, manifest_mode=0o644,
                    parent_uid=0, parent_mode=0o755, active=True, pid=7,
                    service_cwd="/home/deploy/disdex-trading/releases/" + Q,
                    process_cwd="/home/deploy/disdex-trading/releases/" + Q,
                    release_uid=0, release_mode=0o755,
                    marker_uid=0, marker_mode=0o644,
                    marker_sha=Q, state_sha=Q)

    def test_q102_pin_is_independent_of_v52_sha(self):
        self.assertEqual(validate_q102_identity(**self.valid()), Q)
        self.assertNotEqual(V, Q)

    def test_untrusted_or_mismatching_identity_fails_closed(self):
        for change in ({"manifest_uid": 1000}, {"manifest_mode": 0o666}, {"parent_mode": 0o777},
                       {"active": False}, {"pid": 0}, {"process_cwd": "/tmp"},
                       {"service_cwd": "/tmp"}, {"release_uid": 1000}, {"release_mode": 0o777},
                       {"marker_uid": 1000}, {"marker_mode": 0o666},
                       {"marker_sha": V}, {"state_sha": V}):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                validate_q102_identity(**(self.valid() | change))

    def test_wrong_target_and_service_fail_closed(self):
        for mutate in (lambda m: m.update(target="other"),
                       lambda m: m["runners"]["QUALITY102_CAUSAL_V1"].update(serviceUnit="other")):
            value=self.valid()
            mutate(value["manifest"])
            with self.assertRaises(RuntimeError):
                validate_q102_identity(**value)

    def test_each_peer_requires_its_own_named_pin(self):
        for runner, prefix in (("FET_BRK48_RESIDUAL", "disdex-fet-brk48"),
                               ("IDLE_PRIORITY_SHORT", "disdex-idle-priority-short")):
            value = self.valid()
            value["manifest"]["runners"][runner] = {"sha": Q,
                "releaseRoot": "/home/deploy/disdex-trading/releases/" + Q,
                "serviceUnit": prefix + "@" + Q + ".service"}
            self.assertEqual(validate_peer_identity(runner=runner, **value), Q)
            with self.assertRaises(RuntimeError):
                validate_peer_identity(runner="V52", **value)

if __name__ == "__main__":
    unittest.main()
