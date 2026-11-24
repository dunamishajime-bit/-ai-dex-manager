import unittest

from scripts.ops.deploy.disdex_verify_singlewriter_candidate import (
    CandidateGuardError,
    SOURCE_CONTRACT,
    verify_singlewriter_candidate,
)


class CandidateSingletonGateTest(unittest.TestCase):
    def test_accepts_complete_source_bound_to_exact_sha(self):
        data = {path: "\n".join(fragments) for path, fragments in SOURCE_CONTRACT.items()}
        sha = "a" * 40
        seen = []
        def read(target, rel):
            self.assertEqual(target, sha)
            seen.append(rel)
            return data[rel]
        verify_singlewriter_candidate(sha, read)
        self.assertEqual(set(seen), set(SOURCE_CONTRACT))

    def test_rejects_old_candidate_without_protection(self):
        with self.assertRaisesRegex(CandidateGuardError, "SINGLE_WRITER_GUARD_MISSING"):
            verify_singlewriter_candidate("b" * 40, lambda _sha, _rel: "legacy unguarded candidate")

    def test_rejects_missing_candidate_source(self):
        def missing(_sha, _rel):
            raise CandidateGuardError("SINGLE_WRITER_SOURCE_MISSING")
        with self.assertRaisesRegex(CandidateGuardError, "SINGLE_WRITER_SOURCE_MISSING"):
            verify_singlewriter_candidate("c" * 40, missing)

    def test_rejects_malformed_or_mutable_sha(self):
        for value in ("master", "abc", "0" * 39, "X" * 40):
            with self.assertRaisesRegex(CandidateGuardError, "CANDIDATE_SHA_INVALID"):
                verify_singlewriter_candidate(value, lambda _sha, _path: "")


if __name__ == "__main__":
    unittest.main()
