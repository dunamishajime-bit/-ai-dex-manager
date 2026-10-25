#!/usr/bin/env python3
"""Synthetic-only tests. Importing the legacy/native source is prohibited."""
import hashlib
import json
import unittest
from render4427_failclosed_gross_patch_adapter_20261025 import (
    ResearchPatchRejected, rewrite_gross_source_research_only,
    OLD_REQUESTED, OLD_ROOM, NEW_REQUESTED, NEW_ROOM,
)

CASES = {
    "valid": OLD_REQUESTED + OLD_ROOM,
    "missing_requested": OLD_ROOM,
    "duplicate_requested": OLD_REQUESTED * 2 + OLD_ROOM,
    "missing_room": OLD_REQUESTED,
    "duplicate_room": OLD_REQUESTED + OLD_ROOM * 2,
    "prepatched_requested": OLD_REQUESTED + OLD_ROOM + NEW_REQUESTED,
    "prepatched_room": OLD_REQUESTED + OLD_ROOM + NEW_ROOM,
    "crlf": (OLD_REQUESTED + OLD_ROOM).replace("\n", "\r\n"),
}
EXPECTED = {
    "valid": "PASS",
    "missing_requested": "REJECT_FULL_GROSS_HOOK_NOT_UNIQUE",
    "duplicate_requested": "REJECT_FULL_GROSS_HOOK_NOT_UNIQUE",
    "missing_room": "REJECT_ROOM_HOOK_NOT_UNIQUE",
    "duplicate_room": "REJECT_ROOM_HOOK_NOT_UNIQUE",
    "prepatched_requested": "REJECT_PREEXISTING_REWRITE",
    "prepatched_room": "REJECT_PREEXISTING_REWRITE",
    "crlf": "REJECT_FULL_GROSS_HOOK_NOT_UNIQUE",
}

def synthetic_matrix():
    result = {}
    for name, source in CASES.items():
        try:
            rewritten = rewrite_gross_source_research_only(source)
            verdict = "PASS"
            if name == "valid":
                assert rewritten == NEW_REQUESTED + NEW_ROOM
        except ResearchPatchRejected as exc:
            verdict = str(exc).split(":")[0]
        result[name] = verdict
    return result

class AdapterTests(unittest.TestCase):
    def test_contract_matrix(self):
        self.assertEqual(synthetic_matrix(), EXPECTED)

    def test_nonstring_rejected(self):
        for bad in (None, b"bytes", 42, ["source"]):
            with self.subTest(value=repr(bad)):
                with self.assertRaisesRegex(ResearchPatchRejected, "REJECT_NON_STRING_SOURCE"):
                    rewrite_gross_source_research_only(bad)

    def test_purity_on_rejection(self):
        for name, source in CASES.items():
            before = source
            try:
                rewrite_gross_source_research_only(source)
            except ResearchPatchRejected:
                pass
            self.assertEqual(source, before, name)

    def test_idempotence_is_rejected(self):
        first = rewrite_gross_source_research_only(CASES["valid"])
        with self.assertRaises(ResearchPatchRejected):
            rewrite_gross_source_research_only(first)

    def test_source_contains_no_assert_or_exec(self):
        import ast, inspect
        import render4427_failclosed_gross_patch_adapter_20261025 as module
        tree = ast.parse(inspect.getsource(module))
        self.assertFalse(any(isinstance(n, (ast.Assert, ast.Call)) and (
            isinstance(n, ast.Assert) or
            (isinstance(n.func, ast.Name) and n.func.id in {"exec", "eval", "compile", "__import__"})
        ) for n in ast.walk(tree)))

if __name__ == "__main__":
    report = {"status": "SYNTHETIC_RESEARCH_ONLY_NOT_AUTHORIZED", "cases": synthetic_matrix()}
    raw = json.dumps(report, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AdapterTests)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    print("RESEARCH_AUDIT_JSON_SHA256", hashlib.sha256(raw).hexdigest())
    print("RESEARCH_AUDIT_JSON", raw.decode())
    if not result.wasSuccessful():
        raise SystemExit(1)
