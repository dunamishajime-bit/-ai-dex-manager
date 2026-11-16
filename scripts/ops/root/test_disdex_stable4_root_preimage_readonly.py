"""Synthetic source-only checks: no VPS access or Root code import required."""
import hashlib
import json
import os
import ast
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO
import sys
import tempfile
from pathlib import Path
import unittest

import disdex_stable4_root_preimage_readonly as audit


@unittest.skipUnless(os.name == 'posix', 'POSIX ownership, permissions and symlink semantics')
class RootPreimageReadonlyTests(unittest.TestCase):
    def fixture(self):
        tmp = tempfile.TemporaryDirectory()
        root = Path(tmp.name)
        data = {'old_hype.py': b'hype v1\n', 'old_gate.py': b'gate v1\n',
                'old_witness.py': b'venue v1\n'}
        expected = {}
        for name, raw in data.items():
            (root / name).write_bytes(raw)
            expected[name] = hashlib.sha256(raw).hexdigest()
        (root / 'external.py').write_bytes(b'external implementation\n')
        return tmp, root, data, expected

    def test_three_exact_preimages_are_still_not_activation_authority(self):
        tmp, root, data, expected = self.fixture()
        with tmp:
            row = audit.audit(root, reviewed=expected, external='external.py',
                              owner_uid=root.stat().st_uid)
            self.assertEqual(row['status'], 'BASE_PREIMAGES_MATCH_EXTERNAL_REVIEW_REQUIRED')
            self.assertEqual(len(row['reviewedPreimages']), 3)
            self.assertTrue(all(v['status'] == 'EXACT_PREIMAGE_MATCH'
                                for v in row['reviewedPreimages'].values()))
            self.assertEqual(row['externalModule']['status'],
                             'OBSERVED_NOT_INDEPENDENTLY_REVIEWED')
            for field in ('ordersEnabled', 'activationAuthorized',
                          'sourceClosureCertified', 'q102BootstrapAuthorized',
                          'productionMutated'):
                self.assertIs(row[field], False)

    def test_changed_preimage_fails_closed(self):
        tmp, root, data, expected = self.fixture()
        with tmp:
            (root / 'old_gate.py').write_bytes(b'changed')
            row = audit.audit(root, reviewed=expected, external='external.py',
                              owner_uid=root.stat().st_uid)
            self.assertEqual(row['status'], 'BLOCKED_BASE_PREIMAGE_OR_METADATA')
            self.assertEqual(row['reviewedPreimages']['old_gate.py']['status'],
                             'HASH_MISMATCH')

    def test_symlink_preimage_rejected_even_if_contents_match(self):
        tmp, root, data, expected = self.fixture()
        with tmp:
            (root / 'old_hype.py').rename(root / 'target.py')
            (root / 'old_hype.py').symlink_to('target.py')
            row = audit.audit(root, reviewed=expected, external='external.py',
                              owner_uid=root.stat().st_uid)
            self.assertEqual(row['status'], 'BLOCKED_BASE_PREIMAGE_OR_METADATA')
            self.assertEqual(row['reviewedPreimages']['old_hype.py']['status'],
                             'BLOCKED_READ_OR_METADATA')

    def test_missing_external_is_not_accepted(self):
        tmp, root, data, expected = self.fixture()
        with tmp:
            (root / 'external.py').unlink()
            row = audit.audit(root, reviewed=expected, external='external.py',
                              owner_uid=root.stat().st_uid)
            self.assertEqual(row['status'], 'BLOCKED_BASE_PREIMAGE_OR_METADATA')
            self.assertEqual(row['externalModule']['status'], 'BLOCKED_READ_OR_METADATA')

    def test_group_writable_source_rejected(self):
        tmp, root, data, expected = self.fixture()
        with tmp:
            (root / 'old_witness.py').chmod(0o664)
            row = audit.audit(root, reviewed=expected, external='external.py',
                              owner_uid=root.stat().st_uid)
            self.assertEqual(row['reviewedPreimages']['old_witness.py']['status'],
                             'BLOCKED_READ_OR_METADATA')

    def test_invalid_root_directory_rejected(self):
        tmp, root, data, expected = self.fixture()
        with tmp:
            row = audit.audit(root / 'missing', reviewed=expected,
                              external='external.py', owner_uid=root.stat().st_uid)
            self.assertEqual(row['status'], 'BLOCKED_ROOT_DIRECTORY')

    def test_writable_directory_rejected(self):
        tmp, root, data, expected = self.fixture()
        with tmp:
            root.chmod(0o777)
            row = audit.audit(root, reviewed=expected, external='external.py',
                              owner_uid=root.stat().st_uid)
            self.assertEqual(row['status'], 'BLOCKED_ROOT_DIRECTORY')



class CrossPlatformContractTests(unittest.TestCase):
    def test_baselines_equal_reviewed_source_constants(self):
        root = Path(__file__).resolve().parent
        checks = (
            ('disdex_stable4_h48_root_patch.py', 'HYPE_BASE_SHA256',
             'disdex_hype_scoped_root_cutover.py'),
            ('disdex_stable4_h48_root_patch.py', 'GATE_BASE_SHA256',
             'disdex_unified_root_gate.py'),
            ('disdex_stable4_composite_root_bridge.py', 'BASE_HASH',
             'disdex_v4_venue_witness.py'),
        )
        for filename, constant, expected_file in checks:
            tree = ast.parse((root / filename).read_text(encoding='utf-8'))
            values = {target.id: ast.literal_eval(stmt.value)
                      for stmt in tree.body if isinstance(stmt, ast.Assign)
                      for target in stmt.targets if isinstance(target, ast.Name)
                      and target.id == constant}
            self.assertEqual(audit.REVIEWED_PREIMAGES[expected_file], values[constant])

    def test_main_always_returns_non_authorizing_status(self):
        out = StringIO()
        with patch.object(audit, 'audit', return_value={
                'status': 'BASE_PREIMAGES_MATCH_EXTERNAL_REVIEW_REQUIRED',
                'activationAuthorized': False}), patch.object(
                sys, 'argv', ['audit']):
            with redirect_stdout(out):
                code = audit.main()
        self.assertEqual(code, 2)
        self.assertFalse(json.loads(out.getvalue())['activationAuthorized'])

if __name__ == '__main__':
    unittest.main()