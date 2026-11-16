"""Synthetic, no-network regression tests for offline Q102 public request planning."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stable4_q102_public_request_plan import build, HOUR, M5, ARCHIVE_SUFFIX


class Q102OfflinePlanTests(unittest.TestCase):
    T = 1_794_826_800_000  # Synthetic completed hour, independent of wall clock

    def fixture(self, base, *, include_m5=True):
        rolling = json.dumps({"version": 1, "symbols": ["AVAXUSDT"]}).encode()
        first = self.T - 3*M5
        observations = {
            "schema": "disdex-stable4-observation-bootstrap/v1",
            "status": "OBSERVATIONS_CAUGHT_UP_OUTCOME_EVIDENCE_PENDING",
            "ordersEnabled": False, "ordersSent": 0,
            "sourceCacheSha256": hashlib.sha256(rolling).hexdigest(),
            "lastObserved": self.T,
            "model": {"observedThrough": self.T, "pendingContinuationRows": 2},
            "pendingEvidenceRequests": [
                {"symbol": "AVAXUSDT", "from": first, "through": self.T,
                 "includeM5": include_m5, "pendingCount": 2}
            ],
        }
        args = dict(observations_raw=json.dumps(observations).encode(),
                    rolling_raw=rolling, m5_root=Path(base),
                    now_ms=self.T+HOUR+1)
        return args, observations, first

    def archive(self, path, times):
        rows = [[t, "1", "1", "1", "1", "1"] for t in times]
        (Path(path)/("AVAXUSDT"+ARCHIVE_SUFFIX)).write_bytes(
            gzip.compress(("\n".join(json.dumps(r) for r in rows)+"\n").encode()))

    def test_missing_archive_fetches_from_first_required_candle(self):
        with tempfile.TemporaryDirectory() as d:
            args, _, first = self.fixture(d)
            plan = build(**args)
            self.assertEqual(plan["requests"][0]["supplementFrom"], first)
            self.assertFalse(plan["bootstrapInstallationAuthorized"])
            self.assertFalse(plan["writerExclusionCertified"])
            self.assertEqual(plan["ordersSent"], 0)

    def test_contiguous_prefix_reduces_public_fetch_without_hiding_gap(self):
        with tempfile.TemporaryDirectory() as d:
            args, _, first = self.fixture(d)
            self.archive(d, [first, first+M5])
            plan = build(**args)
            self.assertEqual(plan["requests"][0]["supplementFrom"], first+2*M5)
            self.assertEqual(plan["localArchiveCoverage"][0]["localCompleteBars"], 2)

    def test_all_inclusive_candles_present_needs_no_extra_m5(self):
        with tempfile.TemporaryDirectory() as d:
            args, _, first = self.fixture(d)
            self.archive(d, [first, first+M5, first+2*M5, first+3*M5])
            plan = build(**args)
            self.assertEqual(plan["requests"][0]["supplementFrom"], self.T+M5)
            self.assertEqual(plan["localArchiveCoverage"][0]["localCompleteBars"], 3)

    def test_gap_does_not_get_filled_by_later_archived_candles(self):
        with tempfile.TemporaryDirectory() as d:
            args, _, first = self.fixture(d)
            self.archive(d, [first, first+2*M5, first+3*M5])
            plan = build(**args)
            self.assertEqual(plan["requests"][0]["supplementFrom"], first+M5)

    def test_duplicate_or_reverse_archive_blocks(self):
        with tempfile.TemporaryDirectory() as d:
            args, _, first = self.fixture(d)
            self.archive(d, [first+M5, first])
            with self.assertRaisesRegex(ValueError, "UNSORTED"):
                build(**args)

    def test_no_m5_request_never_fetches_m5(self):
        with tempfile.TemporaryDirectory() as d:
            args, _, _ = self.fixture(d, include_m5=False)
            plan = build(**args)
            self.assertFalse(plan["requests"][0]["includeM5"])
            self.assertEqual(plan["requests"][0]["supplementFrom"], self.T+M5)

    def test_source_hash_and_pending_count_are_binding_constraints(self):
        with tempfile.TemporaryDirectory() as d:
            args, obs, _ = self.fixture(d)
            with self.assertRaisesRegex(ValueError, "HASH_MISMATCH"):
                build(**{**args, "rolling_raw": b'{"version":1}'})
            obs["model"]["pendingContinuationRows"] = 1
            with self.assertRaisesRegex(ValueError, "PENDING_COUNT"):
                build(**{**args, "observations_raw": json.dumps(obs).encode()})

    def test_duplicate_json_and_nan_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            args, _, _ = self.fixture(d)
            for raw in (b'{"a":1,"a":2}', b'{"a":NaN}'):
                with self.subTest(raw=raw), self.assertRaises(ValueError):
                    build(**{**args, "observations_raw": raw})

    def test_future_range_duplicate_symbol_and_wrong_type_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            args, obs, _ = self.fixture(d)
            cases = [
                lambda x: x["pendingEvidenceRequests"][0].update({"through": self.T+2*HOUR}),
                lambda x: x["pendingEvidenceRequests"].append(dict(x["pendingEvidenceRequests"][0])),
                lambda x: x["pendingEvidenceRequests"][0].update({"includeM5": 1}),
            ]
            for mutate in cases:
                snapshot=json.loads(json.dumps(obs))
                mutate(snapshot)
                with self.assertRaises(ValueError):
                    build(**{**args,"observations_raw":json.dumps(snapshot).encode()})


if __name__ == "__main__":
    unittest.main()
