#!/usr/bin/env python3
"""Synthetic-only tests for the RENDER #4427 research receipt journal."""
from __future__ import annotations
import dataclasses
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("render_4427_atomic_receipt_research_20261025.py")
spec = importlib.util.spec_from_file_location("render4427_atomic_receipt", SCRIPT)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
A = "a" * 64
B = "b" * 64


def receipt(**kw):
    d = dict(source_id="SYNTHETIC_SOURCE_A", sequence=1, event_id="synthetic-event-1",
             candidate_key=A, entry_projection_sha256=B, inventory_sha256=A,
             proof_manifest_sha256=B, asof_ms=1792890000000)
    d.update(kw)
    return m.Receipt(**d)


def payload(r):
    return json.dumps({**dataclasses.asdict(r), "research_synthetic_only": True},
                      sort_keys=True, separators=(",", ":"))


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="render4427-synthetic-", dir=r"C:\tmp")
        self.db = Path(self.tmp.name) / "receipt.db"

    def tearDown(self):
        self.tmp.cleanup()

    def test_first_is_not_authorization(self):
        self.assertEqual(m.claim(self.db, receipt()), "RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED")

    def test_replay(self):
        m.claim(self.db, receipt())
        self.assertEqual(m.claim(self.db, receipt()), "REJECT_RECEIPT_REPLAY")

    def test_conflicting_event(self):
        m.claim(self.db, receipt())
        self.assertEqual(m.claim(self.db, receipt(candidate_key=B)), "REJECT_RECEIPT_CONFLICT")

    def test_sequence_gap(self):
        self.assertEqual(m.claim(self.db, receipt(sequence=2)), "REJECT_SEQUENCE_GAP")

    def test_sequence_collision(self):
        m.claim(self.db, receipt())
        self.assertEqual(m.claim(self.db, receipt(event_id="different")), "REJECT_SEQUENCE_OUT_OF_ORDER")

    def test_monotonic(self):
        m.claim(self.db, receipt())
        self.assertEqual(m.claim(self.db, receipt(sequence=2, event_id="synthetic-event-2")),
                         "RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED")
        self.assertEqual(m.snapshot(self.db)["cursors"], [["SYNTHETIC_SOURCE_A", 2]])

    def test_independent_sources(self):
        m.claim(self.db, receipt())
        self.assertEqual(m.claim(self.db, receipt(source_id="SYNTHETIC_SOURCE_B")),
                         "RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED")

    def test_bad_digest(self):
        with self.assertRaisesRegex(ValueError, "INVALID_SHA"):
            m.claim(self.db, receipt(inventory_sha256="not-sha"))

    def test_bad_sequence(self):
        with self.assertRaisesRegex(ValueError, "INVALID_SEQUENCE"):
            m.claim(self.db, receipt(sequence=0))

    def test_no_parent(self):
        with self.assertRaisesRegex(ValueError, "RESEARCH_DB_PARENT_MISSING"):
            m.claim(self.db.parent / "missing" / "receipt.db", receipt())

    def test_restart_persistence(self):
        m.claim(self.db, receipt())
        q = subprocess.run([sys.executable, str(SCRIPT), "synthetic-claim",
                            str(self.db), payload(receipt())], capture_output=True,
                           text=True, timeout=25)
        self.assertEqual(q.returncode, 0, q.stderr)
        self.assertEqual(q.stdout.strip(), "REJECT_RECEIPT_REPLAY")

    def test_non_synthetic_cli_rejected(self):
        q = subprocess.run([sys.executable, str(SCRIPT), "synthetic-claim",
                            str(self.db), json.dumps(dataclasses.asdict(receipt()))],
                           capture_output=True, text=True, timeout=25)
        self.assertNotEqual(q.returncode, 0)
        self.assertIn("REJECT_NON_SYNTHETIC_RECEIPT", q.stderr)

    def test_concurrent_processes_one_winner(self):
        procs = [subprocess.Popen([sys.executable, str(SCRIPT), "synthetic-claim",
                                  str(self.db), payload(receipt())],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True) for _ in range(8)]
        outcomes = []
        for p in procs:
            out, err = p.communicate(timeout=40)
            self.assertEqual(p.returncode, 0, err)
            outcomes.append(out.strip())
        self.assertEqual(outcomes.count("RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED"), 1)
        self.assertEqual(outcomes.count("REJECT_RECEIPT_REPLAY"), 7)
        self.assertEqual(len(m.snapshot(self.db)["receipts"]), 1)

    def test_concurrent_conflicting_payloads(self):
        procs = [subprocess.Popen([sys.executable, str(SCRIPT), "synthetic-claim",
                                  str(self.db), payload(receipt(candidate_key=(A if i % 2 else B)))],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True) for i in range(6)]
        outcomes = []
        for p in procs:
            out, err = p.communicate(timeout=40)
            self.assertEqual(p.returncode, 0, err)
            outcomes.append(out.strip())
        self.assertEqual(outcomes.count("RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED"), 1)
        self.assertEqual(len(m.snapshot(self.db)["receipts"]), 1)
        self.assertTrue(all(x in ("RECORDED_RESEARCH_ONLY_NOT_AUTHORIZED",
                                  "REJECT_RECEIPT_REPLAY", "REJECT_RECEIPT_CONFLICT")
                            for x in outcomes))


if __name__ == "__main__":
    unittest.main(verbosity=2)
