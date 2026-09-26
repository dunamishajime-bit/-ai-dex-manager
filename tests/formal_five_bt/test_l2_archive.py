import unittest

from research.formal_five_bt.l2_archive import BookSequenceEvent, validate_bybit_event_chain, validate_event_chain


class L2ArchiveSequenceTests(unittest.TestCase):
    def test_contiguous_updates_after_snapshot_are_verified(self):
        rows = [
            BookSequenceEvent("snapshot", 1000, 1_000_000, None, 10, None),
            BookSequenceEvent("update", 2000, 2_000_000, 11, 12, 10),
            BookSequenceEvent("update", 3000, 3_000_000, 13, 15, 12),
        ]
        result = validate_event_chain(rows)
        self.assertEqual(result.status, "VERIFIED")
        self.assertEqual(result.snapshots, 1)
        self.assertEqual(result.updates, 2)

    def test_update_only_archive_is_never_counted_as_a_verified_book(self):
        result = validate_event_chain([BookSequenceEvent("update", 2000, 2_000_000, 11, 12, 10)])
        self.assertEqual(result.status, "NOT_VERIFIABLE")
        self.assertIn("BOOK_UPDATE_WITHOUT_SNAPSHOT", {issue.code for issue in result.issues})
        self.assertIn("NO_SNAPSHOT_IN_CHAIN", {issue.code for issue in result.issues})

    def test_gapped_update_id_chain_is_not_verified(self):
        rows = [
            BookSequenceEvent("snapshot", 1000, 1_000_000, None, 10, None),
            BookSequenceEvent("update", 2000, 2_000_000, 13, 14, 10),
        ]
        result = validate_event_chain(rows)
        self.assertEqual(result.status, "NOT_VERIFIABLE")
        self.assertIn("BOOK_SEQUENCE_GAP", {issue.code for issue in result.issues})

    def test_bybit_ignores_unseeded_prefix_then_accepts_consecutive_u_updates(self):
        rows = [
            BookSequenceEvent("update", 500, 500_000, None, 8, None),
            BookSequenceEvent("snapshot", 1000, 1_000_000, None, 10, None),
            BookSequenceEvent("update", 1100, 1_100_000, None, 11, None),
            BookSequenceEvent("update", 1200, 1_200_000, None, 12, None),
        ]
        result = validate_bybit_event_chain(rows)
        self.assertEqual(result.status, "VERIFIED")
        self.assertEqual(result.snapshots, 1)

    def test_bybit_update_id_gap_and_reset_without_snapshot_are_not_verified(self):
        for update in (12, 1):
            rows = [
                BookSequenceEvent("snapshot", 1000, 1_000_000, None, 10, None),
                BookSequenceEvent("update", 1100, 1_100_000, None, update, None),
            ]
            result = validate_bybit_event_chain(rows)
            self.assertEqual(result.status, "NOT_VERIFIABLE")
            self.assertTrue({"BOOK_SEQUENCE_GAP", "UPDATE_RESTART_WITHOUT_SNAPSHOT"} & {issue.code for issue in result.issues})


if __name__ == "__main__":
    unittest.main()
