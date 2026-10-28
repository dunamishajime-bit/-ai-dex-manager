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


def v52_live_pinned(pin_path=Path('/etc/disdex/current-runtime/v52-current.env'),
                    heartbeat_path=Path('/var/lib/disdex/runner-health/heartbeats/v52.json')):
    """Read-only, fail-closed current V52 identity. Never grant FET exposure."""
    try:
        stat = pin_path.lstat()
        if not pin_path.is_file() or pin_path.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o022:
            return False, 'FET_PREEMPTION_V52_PIN_UNTRUSTED'
        pairs = {}
        for line in pin_path.read_text().splitlines():
            if '=' in line:
                key, value = line.split('=', 1)
                if key in ('DISDEX_V52_RUNTIME_SHA', 'DISDEX_V52_RUNTIME_ROOT'):
                    pairs[key] = value.strip()
        sha = pairs.get('DISDEX_V52_RUNTIME_SHA', '')
        root = pairs.get('DISDEX_V52_RUNTIME_ROOT', '')
        if not re.fullmatch(r'[0-9a-f]{40}', sha) or root != '/home/deploy/disdex-trading/releases/' + sha:
            return False, 'FET_PREEMPTION_V52_PIN_INVALID'
        release = Path(root)
        marker = release / '.disdex-release-sha'
        if release.is_symlink() or marker.is_symlink() or not marker.is_file() or marker.read_text().strip() != sha:
            return False, 'FET_PREEMPTION_V52_RELEASE_MISMATCH'
        unit = 'disdex-v52-aster-only@' + sha + '.service'
        if subprocess.check_output(['systemctl', 'show', unit, '-p', 'ActiveState', '--value'], text=True, timeout=8).strip() != 'active':
            return False, 'FET_PREEMPTION_V52_NOT_RUNNING'
        pid_raw = subprocess.check_output(['systemctl', 'show', unit, '-p', 'MainPID', '--value'], text=True, timeout=8).strip()
        if not pid_raw.isdecimal() or int(pid_raw) <= 0:
            return False, 'FET_PREEMPTION_V52_NOT_RUNNING'
        if os.path.realpath('/proc/' + pid_raw + '/cwd') != root:
            return False, 'FET_PREEMPTION_V52_WORKING_DIRECTORY_MISMATCH'
        if heartbeat_path.is_symlink():
            return False, 'FET_PREEMPTION_V52_HEARTBEAT_UNTRUSTED'
        hb = json.loads(heartbeat_path.read_text())
        if (hb.get('runtimeSha') != sha or hb.get('expectedSha') != sha or hb.get('serviceUnit') != unit
                or hb.get('mainPid') != int(pid_raw) or hb.get('mode') != 'LIVE'
                or hb.get('safetyState') != 'HEALTHY' or hb.get('newOrdersAllowed') is not True
                or int(time.time() * 1000) - int(hb.get('heartbeatAt') or 0) > 300000
                or int(hb.get('heartbeatAt') or 0) > int(time.time() * 1000) + 10000):
            return False, 'FET_PREEMPTION_V52_HEARTBEAT_INVALID'
        return True, 'V52_PINNED_IDENTITY_PASS'
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
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
