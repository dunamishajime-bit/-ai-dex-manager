import unittest
from scripts.research import formal_venue_availability as audit


class VenueAvailabilityTests(unittest.TestCase):
    def test_actual_production_signal_is_not_suppressed_by_invented_warmup(self):
        self.assertEqual(audit.classify(10*3600000, 2000, True, {'eligible':True})[0], 'ELIGIBLE')

    def test_non_history_error_during_warmup_is_not_hidden(self):
        self.assertEqual(audit.classify(10*3600000, 2000, True, {'error':'invalidVolume'})[0], 'SOURCE_ERROR')

    def test_production_accepted_flag_is_preserved(self):
        decision = audit.signal_decision({'accepted': True, 'reason':'DOGE_REL_VOL'})
        self.assertEqual(audit.classify(300000000, 2000, True, decision)[0], 'ELIGIBLE')

    def test_missing_listing_evidence_never_implies_unlisted(self):
        self.assertEqual(audit.classify(1000, None, False, None)[0], 'SOURCE_ERROR')

    def test_official_pre_listing_is_not_missing_source(self):
        self.assertEqual(audit.classify(1000, 2000, False, None),
                         ('VENUE_PAIR_UNAVAILABLE', 'BEFORE_OFFICIAL_ONBOARD_DATE'))

    def test_listed_missing_bar_stays_blocked_even_during_warmup(self):
        self.assertEqual(audit.classify(8000000, 2000, False, None),
                         ('SOURCE_ERROR', 'SOURCE_EVIDENCE_MISSING'))

    def test_partial_first_hour_is_not_used_as_complete_bar(self):
        self.assertEqual(audit.classify(3600000, 1800000, True, None)[0], 'NO_SIGNAL')
        self.assertEqual(audit.classify(270000000, 1800000, True, {'eligible': True})[0], 'ELIGIBLE')

    def test_source_failure_never_becomes_no_signal(self):
        self.assertEqual(audit.classify(300000000, 2000, True, {'error':'invalidVolume'})[0], 'SOURCE_ERROR')

    def test_missing_strategy_decision_is_not_no_signal(self):
        self.assertEqual(audit.classify(300000000, 2000, True, None),
                         ('SOURCE_ERROR', 'BASELINE_DECISION_EVIDENCE_MISSING'))


if __name__ == '__main__':
    unittest.main()
