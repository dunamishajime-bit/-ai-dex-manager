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


def validate_v52_contract(pin, hb, now_ms, pid, cwd, marker_sha, active):
    if not isinstance(pin, dict):
        return 'FET_PREEMPTION_V52_PIN_MISSING'
    sha = str(pin.get('sha') or '').strip().lower()
    root = str(pin.get('releaseRoot') or '').strip()
    unit = str(pin.get('serviceUnit') or '').strip()
    evidence_mode = str(pin.get('evidenceMode') or '').strip()
    expected_root = '/home/deploy/disdex-trading/releases/' + sha
    expected_unit = 'disdex-v52-aster-only@' + sha + '.service'
    if (not re.fullmatch(r'[0-9a-f]{40}', sha) or root != expected_root
            or unit != expected_unit or evidence_mode != 'heartbeat_v1'):
        return 'FET_PREEMPTION_V52_PIN_INVALID'
    if marker_sha != sha:
        return 'FET_PREEMPTION_V52_RELEASE_MISMATCH'
    if not active or not isinstance(pid, int) or pid <= 0:
        return 'FET_PREEMPTION_V52_NOT_RUNNING'
    if cwd != root:
        return 'FET_PREEMPTION_V52_WORKING_DIRECTORY_MISMATCH'
    if not isinstance(hb, dict):
        return 'FET_PREEMPTION_V52_HEARTBEAT_INVALID'
    heartbeat_at = hb.get('heartbeatAt')
    last_tick_at = hb.get('lastTickAt')
    if (hb.get('schema') != 'disdex-runner-heartbeat/v1'
            or hb.get('runnerId') != 'V52'
            or hb.get('runtimeSha') != sha or hb.get('expectedSha') != sha
            or hb.get('serviceUnit') != unit or hb.get('mainPid') != pid
            or hb.get('workingDirectory') != root
            or hb.get('mode') != 'LIVE' or hb.get('safetyState') != 'HEALTHY'
            or hb.get('newOrdersAllowed') is not True
            or type(heartbeat_at) is not int or type(last_tick_at) is not int
            or heartbeat_at <= 0 or last_tick_at <= 0
            or heartbeat_at > now_ms + 10000 or last_tick_at > now_ms + 10000
            or now_ms - heartbeat_at > 300000 or now_ms - last_tick_at > 300000):
        return 'FET_PREEMPTION_V52_HEARTBEAT_INVALID'
    return None


def v52_live_pinned(manifest_path=Path('/etc/disdex/runner-pins.json')):
    """Read-only, fail-closed V52 identity from the canonical runner-pin manifest."""
    try:
        stat = manifest_path.lstat()
        if (not manifest_path.is_file() or manifest_path.is_symlink()
                or stat.st_uid != 0 or stat.st_mode & 0o022):
            return False, 'FET_PREEMPTION_RUNNER_PIN_MANIFEST_UNTRUSTED'
        manifest = json.loads(manifest_path.read_text())
        if (manifest.get('schema') != 'disdex-runner-pin-manifest/v2'
                or manifest.get('target') != 'professional-dismanager.net'
                or manifest.get('operatorTarget') != 'DD1296_FINAL_ALLIN_10BPS'):
            return False, 'FET_PREEMPTION_RUNNER_PIN_MANIFEST_INVALID'
        pin = (manifest.get('runners') or {}).get('V52')
        if not isinstance(pin, dict):
            return False, 'FET_PREEMPTION_V52_PIN_MISSING'
        sha = str(pin.get('sha') or '').strip().lower()
        root = str(pin.get('releaseRoot') or '').strip()
        unit = str(pin.get('serviceUnit') or '').strip()
        health_path = Path(str(pin.get('healthPath') or '').strip())
        if (not str(health_path).startswith('/var/lib/disdex/')
                or '..' in health_path.parts):
            return False, 'FET_PREEMPTION_V52_HEALTH_PATH_INVALID'

        release = Path(root)
        marker = release / '.disdex-release-sha'
        if release.is_symlink() or marker.is_symlink() or not marker.is_file():
            return False, 'FET_PREEMPTION_V52_RELEASE_MISMATCH'
        marker_sha = marker.read_text().strip()
        active = subprocess.check_output(
            ['systemctl', 'show', unit, '-p', 'ActiveState', '--value'],
            text=True, timeout=8).strip() == 'active'
        pid_raw = subprocess.check_output(
            ['systemctl', 'show', unit, '-p', 'MainPID', '--value'],
            text=True, timeout=8).strip()
        pid = int(pid_raw) if pid_raw.isdecimal() else 0
        cwd = os.path.realpath('/proc/' + str(pid) + '/cwd') if pid > 0 else ''
        if health_path.is_symlink() or not health_path.is_file():
            return False, 'FET_PREEMPTION_V52_HEARTBEAT_UNTRUSTED'
        hb = json.loads(health_path.read_text())
        reason = validate_v52_contract(pin, hb, int(time.time() * 1000), pid, cwd, marker_sha, active)
        if reason:
            return False, reason
        return True, 'V52_PINNED_IDENTITY_PASS'
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError, json.JSONDecodeError):
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
