#!/usr/bin/env python3
"""Read-only FET preemption configuration guard. Never changes orders or risk gates."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time


def approved_ready(path, sha):
    try:
        artifact = json.loads(Path(path).read_text())
        return (artifact.get('approvedSha') == sha
                and artifact.get('ordersEnabled') is True
                and artifact.get('operatorAcknowledgement') == 'I_ACK_REAL_MONEY_LIVE_ACTIVATION'
                and {'V52', 'FET_BRK48_RESIDUAL'}.issubset(artifact.get('approvedRunners', []))
                and artifact.get('fetCorePreemptionReady') is True)
    except (OSError, ValueError, TypeError):
        return False


def ready(value):
    return str(value).lower() in ('1', 'true', 'yes', 'on')


def evaluate(sha, approval, env, config_flag=None):
    reasons = []
    if not re.fullmatch(r'[0-9a-f]{40}', sha) or env.get('DISDEX_RUNTIME_COMMIT_SHA') != sha:
        reasons.append('FET_PREEMPTION_RUNTIME_SHA_MISMATCH')
    if not approval:
        reasons.append('FET_PREEMPTION_EXACT_SHA_APPROVAL_REQUIRED')
    if not ready(env.get('FET_BRK48_CORE_PREEMPTION_READY', '')):
        reasons.append('FET_PREEMPTION_FLAG_NOT_READY')
    if config_flag is not None and not ready(config_flag):
        reasons.append('FET_PREEMPTION_DURABLE_CONFIG_NOT_READY')
    return dict(schema='fet-preemption-readiness/v1', status='BLOCKED' if reasons else 'HEALTHY',
                productionSha=sha, reasons=reasons, checkedAt=int(time.time() * 1000),
                ordersSent=0, cancelsSent=0, killSwitchChanges=0)


def parse_v52_manifest_pin(doc):
    if not isinstance(doc, dict) or doc.get('schema') != 'disdex-runner-pin-manifest/v2':
        raise RuntimeError('FET_PREEMPTION_RUNNER_MANIFEST_SCHEMA_INVALID')
    if doc.get('target') != 'professional-dismanager.net':
        raise RuntimeError('FET_PREEMPTION_RUNNER_MANIFEST_TARGET_INVALID')
    if doc.get('operatorTarget') != 'DD1296_FINAL_ALLIN_10BPS':
        raise RuntimeError('FET_PREEMPTION_RUNNER_MANIFEST_OPERATOR_INVALID')
    runners = doc.get('runners')
    row = runners.get('V52') if isinstance(runners, dict) else None
    if not isinstance(row, dict):
        raise RuntimeError('FET_PREEMPTION_V52_MANIFEST_PIN_MISSING')
    sha = str(row.get('sha') or '').strip().lower()
    root = str(row.get('releaseRoot') or '').strip()
    unit = str(row.get('serviceUnit') or '').strip()
    mode = str(row.get('evidenceMode') or '').strip()
    health = str(row.get('healthPath') or '').strip()
    tick = str(row.get('tickPath') or '').strip()
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise RuntimeError('FET_PREEMPTION_V52_MANIFEST_SHA_INVALID')
    if root != '/home/deploy/disdex-trading/releases/' + sha:
        raise RuntimeError('FET_PREEMPTION_V52_MANIFEST_ROOT_MISMATCH')
    if unit != 'disdex-v52-aster-only@' + sha + '.service':
        raise RuntimeError('FET_PREEMPTION_V52_MANIFEST_UNIT_MISMATCH')
    if mode not in ('legacy-state-v1', 'tick-v1'):
        raise RuntimeError('FET_PREEMPTION_V52_MANIFEST_EVIDENCE_MODE_INVALID')
    if not health.startswith('/var/lib/disdex/') or not tick.startswith('/var/lib/disdex/runner-health/ticks/'):
        raise RuntimeError('FET_PREEMPTION_V52_MANIFEST_EVIDENCE_PATH_INVALID')
    return dict(sha=sha, releaseRoot=root, serviceUnit=unit, evidenceMode=mode,
                healthPath=health, tickPath=tick)


def _trusted_regular_json(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('FET_PREEMPTION_EVIDENCE_UNTRUSTED')
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise RuntimeError('FET_PREEMPTION_EVIDENCE_INVALID')
    return value


def _fresh_millis(value, maximum_age_ms=300000):
    if type(value) is not int or value <= 0:
        return False
    now = int(time.time() * 1000)
    age = now - value
    return -10000 <= age <= maximum_age_ms


def v52_live_pinned(manifest_path=Path('/etc/disdex/runner-pins.json')):
    """Read-only, fail-closed V52 identity from the canonical per-runner manifest."""
    try:
        stat = manifest_path.lstat()
        if not manifest_path.is_file() or manifest_path.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o022:
            return False, 'FET_PREEMPTION_RUNNER_MANIFEST_UNTRUSTED'
        pin = parse_v52_manifest_pin(json.loads(manifest_path.read_text()))
        sha = pin['sha']
        root = pin['releaseRoot']
        unit = pin['serviceUnit']
        release = Path(root)
        marker = release / '.disdex-release-sha'
        if release.is_symlink() or marker.is_symlink() or not marker.is_file() or marker.read_text().strip() != sha:
            return False, 'FET_PREEMPTION_V52_RELEASE_MISMATCH'
        if subprocess.check_output(['systemctl', 'show', unit, '-p', 'ActiveState', '--value'],
                                   text=True, timeout=8).strip() != 'active':
            return False, 'FET_PREEMPTION_V52_NOT_RUNNING'
        pid_raw = subprocess.check_output(['systemctl', 'show', unit, '-p', 'MainPID', '--value'],
                                          text=True, timeout=8).strip()
        if not pid_raw.isdecimal() or int(pid_raw) <= 0:
            return False, 'FET_PREEMPTION_V52_NOT_RUNNING'
        if os.path.realpath('/proc/' + pid_raw + '/cwd') != root:
            return False, 'FET_PREEMPTION_V52_WORKING_DIRECTORY_MISMATCH'

        if pin['evidenceMode'] == 'legacy-state-v1':
            state = _trusted_regular_json(Path(pin['healthPath']))
            runtime_sha = str(state.get('runtimeCommitSha') or state.get('runtimeSha') or '').strip().lower()
            if (runtime_sha != sha or str(state.get('mode') or '').upper() != 'LIVE'
                    or str(state.get('status') or '').lower() not in ('ready', 'healthy', 'running')
                    or state.get('pending') is not None or state.get('pendingOrder') is not None
                    or state.get('manualReview') not in (None, False, '')
                    or state.get('operatorReviewRequired') not in (None, False)
                    or state.get('newOrdersAllowed') is not True
                    or not _fresh_millis(state.get('updatedAt'))):
                return False, 'FET_PREEMPTION_V52_LEGACY_STATE_INVALID'
        else:
            tick = _trusted_regular_json(Path(pin['tickPath']))
            if (tick.get('runtimeSha') != sha or tick.get('expectedSha') != sha
                    or tick.get('serviceUnit') != unit
                    or tick.get('mainPid') != int(pid_raw)
                    or tick.get('runnerId') not in ('V52', 'v52')
                    or not _fresh_millis(tick.get('tickCompletedAt'))):
                return False, 'FET_PREEMPTION_V52_TICK_INVALID'
        return True, 'V52_MANIFEST_IDENTITY_PASS'
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError):
        return False, 'FET_PREEMPTION_V52_AUDIT_SOURCE_UNAVAILABLE'


def main():
    p = argparse.ArgumentParser()
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--approved-ready', action='store_true')
    mode.add_argument('--prestart', action='store_true')
    mode.add_argument('--audit', action='store_true')
    p.add_argument('--sha')
    p.add_argument('--activation-path', default='/var/lib/disdex/shared/operator-activation/current.json')
    p.add_argument('--current', default='/home/deploy/disdex-trading/current')
    p.add_argument('--status-path')
    args = p.parse_args()
    sha = args.sha or (Path(args.current) / '.disdex-release-sha').read_text().strip()
    approval = approved_ready(args.activation_path, sha)
    if args.approved_ready:
        print('true' if approval else 'false')
        return 0
    env = os.environ
    config_flag = None
    v52_running = True
    try:
        if args.audit:
            # Read only the two non-secret readiness keys from the durable runtime
            # contract first.  This remains available even when V52 is intentionally
            # fail-closed by ExecCondition, so the audit can report the real blocker
            # instead of collapsing to SOURCE_UNAVAILABLE.
            config_env = {}
            for line in Path('/etc/disdex/current-runtime', sha + '.env').read_text().splitlines():
                if '=' not in line:
                    continue
                key, value = line.split('=', 1)
                if key in ('DISDEX_RUNTIME_COMMIT_SHA', 'FET_BRK48_CORE_PREEMPTION_READY'):
                    config_env[key] = value.strip()
            config_flag = config_env.get('FET_BRK48_CORE_PREEMPTION_READY', '')
            # FET uses its own global/legacy authorization SHA. V52 has a
            # separately approved current instance SHA. Do not require both
            # runners to share a release commit or use V52's env as FET's env.
            env = config_env
            v52_running, v52_reason = v52_live_pinned()
        result = evaluate(sha, approval, env, config_flag)
        if args.audit and not v52_running and result['status'] == 'HEALTHY':
            result['status'] = 'BLOCKED'
            result['reasons'].append(v52_reason)
    except (OSError, ValueError, subprocess.SubprocessError):
        result = dict(schema='fet-preemption-readiness/v1', status='BLOCKED', productionSha=sha,
                      reasons=['FET_PREEMPTION_AUDIT_SOURCE_UNAVAILABLE'], checkedAt=int(time.time()*1000),
                      ordersSent=0, cancelsSent=0, killSwitchChanges=0)
    if args.status_path:
        path = Path(args.status_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + '.' + str(os.getpid()) + '.tmp')
        temp.write_text(json.dumps(result, indent=2) + '\n')
        temp.chmod(0o644)
        os.replace(temp, path)
    print(json.dumps(result))
    return 0 if result['status'] == 'HEALTHY' else 1


if __name__ == '__main__':
    raise SystemExit(main())
