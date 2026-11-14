import unittest
from disdex_v4_admission_clock_compatibility import economic_source_equal, OLD_CLOCK, NEW_CLOCK

class ClockCompatibilityTest(unittest.TestCase):
    def test_identical_sources_and_line_endings(self):
        self.assertTrue(economic_source_equal(b'caps=3\r\n', b'caps=3\n'))

    def test_only_exact_forward_clock_classification_patch(self):
        old=b'unchanged quantities\n'+OLD_CLOCK+b'unchanged exits\n'
        new=b'unchanged quantities\n'+NEW_CLOCK+b'unchanged exits\n'
        self.assertTrue(economic_source_equal(old,new))
        for changed in [new.replace(b'quantities',b'sizing'),new.replace(b'15*60_000',b'16*60_000'),new.replace(b'observedAtMs<input.ts',b'observedAtMs<=input.ts'),new+NEW_CLOCK,new.replace(NEW_CLOCK,b''),new.replace(b'unchanged exits',b' unchanged exits')]:
            self.assertFalse(economic_source_equal(old,changed))
        self.assertFalse(economic_source_equal(old+OLD_CLOCK,new+NEW_CLOCK))
        self.assertFalse(economic_source_equal(new,old), 'does not authorize restoring fatal expiry behavior')

if __name__=='__main__':unittest.main()
