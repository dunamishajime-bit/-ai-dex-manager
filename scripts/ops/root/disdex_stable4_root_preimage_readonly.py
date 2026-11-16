"""Read-only Stable4 external Root source hash audit; never authorizes activation.

The three base preimages are independently frozen by the reviewed H48 and
composite patch contracts. The fourth module is an EXTERNAL dependency: merely
observing its checksum cannot constitute source review or approval. This tool
performs no imports, no code execution from the inspected directory and no
modification, deployment, systemd, order or private-file operations.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat

ROOT = Path('/usr/local/libexec/disdex-unified')
REVIEWED_PREIMAGES = {
    'disdex_hype_scoped_root_cutover.py':
        '710ae088dcb9a8a2793bd3890f276696dd2ae3cddebe365757bcda6c5eb80882',
    'disdex_unified_root_gate.py':
        'dd8ea03b2d890c355050e5d029f0fc74dbc101ae37ab766907c108966c25f529',
    'disdex_v4_venue_witness.py':
        '99c224070708f4714090e1dfb969ffbec41b12a5933bf37c22373a55cdba6c3c',
}
EXTERNAL_MODULE = 'disdex_pending_maintenance_install.py'
# Independently observed file bytes, not source review or owner approval.
EXTERNAL_OBSERVED_SHA256 = 'b852b283cffb189f92be8ac50611621dff0dae3f3aa810af2022de2d5de9a1a5'


def _snapshot(path, *, owner_uid=0):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or path.is_symlink():
        raise ValueError('NOT_REGULAR_NON_SYMLINK')
    if before.st_uid != owner_uid or (before.st_mode & 0o022):
        raise ValueError('SOURCE_OWNER_OR_WRITABILITY')
    raw = path.read_bytes()
    after = path.lstat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
            before.st_mode, before.st_uid) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                after.st_mode, after.st_uid):
        raise ValueError('SOURCE_CHANGED_DURING_READ')
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw)}


def audit(root=ROOT, *, reviewed=REVIEWED_PREIMAGES, external=EXTERNAL_MODULE, observed_external_sha256=EXTERNAL_OBSERVED_SHA256, owner_uid=0):
    result = {
        'schema': 'disdex-stable4-external-root-preimage-readonly/v1',
        'scope': 'READ_ONLY_NON_AUTHORIZING',
        'root': str(root),
        'reviewedPreimages': {},
        'externalModule': {},
        'ordersEnabled': False,
        'activationAuthorized': False,
        'sourceClosureCertified': False,
        'q102BootstrapAuthorized': False,
        'productionMutated': False,
    }
    try:
        directory = root.lstat()
        if not stat.S_ISDIR(directory.st_mode) or root.is_symlink():
            raise ValueError('ROOT_DIRECTORY_INVALID')
        if directory.st_uid != owner_uid or directory.st_mode & 0o022:
            raise ValueError('ROOT_DIRECTORY_OWNER_OR_WRITABILITY')
    except (OSError, ValueError) as exc:
        result['status'] = 'BLOCKED_ROOT_DIRECTORY'
        result['reason'] = type(exc).__name__ if isinstance(exc, OSError) else str(exc)
        return result

    blocked = False
    for name, expected in reviewed.items():
        if not re.fullmatch(r'[0-9a-f]{64}', expected):
            raise ValueError('INVALID_INDEPENDENT_BASELINE')
        try:
            found = _snapshot(root / name, owner_uid=owner_uid)
            found['expectedSha256'] = expected
            found['status'] = 'EXACT_PREIMAGE_MATCH' if found['sha256'] == expected else 'HASH_MISMATCH'
        except (OSError, ValueError) as exc:
            found = {'status': 'BLOCKED_READ_OR_METADATA',
                     'reason': type(exc).__name__ if isinstance(exc, OSError) else str(exc)}
        blocked |= found['status'] != 'EXACT_PREIMAGE_MATCH'
        result['reviewedPreimages'][name] = found

    try:
        found = _snapshot(root / external, owner_uid=owner_uid)
        if not re.fullmatch(r'[0-9a-f]{64}', observed_external_sha256):
            raise ValueError('INVALID_OBSERVED_EXTERNAL_BASELINE')
        found['observedExpectedSha256'] = observed_external_sha256
        found['status'] = ('OBSERVED_NOT_INDEPENDENTLY_REVIEWED'
                           if found['sha256'] == observed_external_sha256
                           else 'BLOCKED_OBSERVED_EXTERNAL_CHANGED')
        blocked |= found['status'] != 'OBSERVED_NOT_INDEPENDENTLY_REVIEWED'
        result['externalModule'] = {'name': external, **found}
    except (OSError, ValueError) as exc:
        result['externalModule'] = {
            'name': external, 'status': 'BLOCKED_READ_OR_METADATA',
            'reason': type(exc).__name__ if isinstance(exc, OSError) else str(exc),
        }
        blocked = True

    result['status'] = ('BLOCKED_BASE_PREIMAGE_OR_METADATA' if blocked
                        else 'BASE_PREIMAGES_MATCH_EXTERNAL_REVIEW_REQUIRED')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root-dir', default=str(ROOT))
    args = parser.parse_args()
    row = audit(Path(args.root_dir))
    print(json.dumps(row, indent=2, sort_keys=True))
    # Intentionally never treat this as an activation-ready certificate.
    return 2


if __name__ == '__main__':
    raise SystemExit(main())