#!/usr/bin/env python3
"""Read-only FET preemption configuration guard. Never changes orders or risk gates."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time


RUNNER_PIN_SCHEMA = "disdex-runner-pin-manifest/v2"
DEFAULT_RUNNER_PINS = "/etc/disdex/runner-pins.json"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


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


def load_v52_pin(path):
    raw = json.loads(Path(path).read_text())
    if raw.get('schema') != RUNNER_PIN_SCHEMA or raw.get('target') != 'professional-dismanager.net':
        raise ValueError('V52_PIN_MANIFEST_IDENTITY_INVALID')
    runners = raw.get('runners')
    if not isinstance(runners, dict) or not isinstance(runners.get('V52'), dict):
        raise ValueError('V52_PIN_MISSING')
    pin = runners['V52']
    sha = str(pin.get('sha') or '').lower()
    release_root = str(pin.get('releaseRoot') or '')
    service_unit = str(pin.get('serviceUnit') or '')
    health_path = str(pin.get('healthPath') or '')
    tick_path = str(pin.get('tickPath') or '')
    if not SHA_RE.fullmatch(sha):
        raise ValueError('V52_PIN_SHA_INVALID')
    if release_root != '/home/deploy/disdex-trading/releases/' + sha:
        raise ValueError('V52_PIN_RELEASE_ROOT_INVALID')
    if service_unit != 'disdex-v52-aster-only@' + sha + '.service':
        raise ValueError('V52_PIN_SERVICE_INVALID')
    if not health_path.startswith('/var/lib/disdex/runner-health/heartbeats/') or not health_path.endswith('.json'):
        raise ValueError('V52_PIN_HEALTH_PATH_INVALID')
    if not tick_path.startswith('/var/lib/disdex/runner-health/ticks/') or not tick_path.endswith('.json'):
        raise ValueError('V52_PIN_TICK_PATH_INVALID')
    return dict(sha=sha, releaseRoot=release_root, serviceUnit=service_unit,
                healthPath=health_path, tickPath=tick_path)


def verify_v52_identity(pin):
    marker = Path(pin['releaseRoot']) / '.disdex-release-sha'
    if not marker.is_file() or marker.is_symlink() or marker.read_text().strip() != pin['sha']:
        return False, 'FET_PREEMPTION_V52_RELEASE_MARKER_INVALID', dict(
            sha=pin['sha'], serviceUnit=pin['serviceUnit'], pid=0)
    output = subprocess.check_output([
        'systemctl', 'show', pin['serviceUnit'],
        '-p', 'MainPID', '-p', 'ActiveState', '-p', 'WorkingDirectory',
        '--no-pager',
    ], text=True)
    props = {}
    for line in output.splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            props[key] = value
    pid = props.get('MainPID', '')
    v52_running = pid.isdigit() and int(pid) > 0
    if not v52_running or props.get('ActiveState') != 'active':
        return False, 'FET_PREEMPTION_V52_NOT_RUNNING', dict(
            sha=pin['sha'], serviceUnit=pin['serviceUnit'], pid=int(pid or 0))
    if props.get('WorkingDirectory') != pin['releaseRoot']:
        return False, 'FET_PREEMPTION_V52_SYSTEMD_CWD_INVALID', dict(
            sha=pin['sha'], serviceUnit=pin['serviceUnit'], pid=int(pid))
    proc_cwd = os.path.realpath('/proc/' + pid + '/cwd')
    if proc_cwd != pin['releaseRoot']:
        return False, 'FET_PREEMPTION_V52_PID_CWD_INVALID', dict(
            sha=pin['sha'], serviceUnit=pin['serviceUnit'], pid=int(pid))
    return True, '', dict(sha=pin['sha'], serviceUnit=pin['serviceUnit'], pid=int(pid))


def read_fet_config(sha):
    config_env = {}
    for line in Path('/etc/disdex/current-runtime', sha + '.env').read_text().splitlines():
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key in ('DISDEX_RUNTIME_COMMIT_SHA', 'FET_BRK48_CORE_PREEMPTION_READY'):
            config_env[key] = value.strip()
    return config_env


def main():
    p = argparse.ArgumentParser()
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--approved-ready', action='store_true')
    mode.add_argument('--prestart', action='store_true')
    mode.add_argument('--audit', action='store_true')
    p.add_argument('--sha')
    p.add_argument('--activation-path', default='/var/lib/disdex/shared/operator-activation/current.json')
    p.add_argument('--current', default='/home/deploy/disdex-trading/current')
    p.add_argument('--runner-pins', default=DEFAULT_RUNNER_PINS)
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
    v52_meta = None
    try:
        if args.audit:
            # FET readiness is derived from FET's own runtime contract. V52 is
            # validated independently from the root-owned multi-SHA runner pin;
            # never substitute the shared/current SHA for V52.
            config_env = read_fet_config(sha)
            config_flag = config_env.get('FET_BRK48_CORE_PREEMPTION_READY', '')
            env = config_env
            v52_pin = load_v52_pin(args.runner_pins)
            pid = subprocess.check_output(
                ['systemctl', 'show', v52_pin['serviceUnit'], '-p', 'MainPID', '--value'],
                text=True,
            ).strip()
            v52_running = pid.isdigit() and int(pid) > 0
            if v52_running:
                v52_ok, v52_reason, v52_meta = verify_v52_identity(v52_pin)
            else:
                env = config_env
                v52_ok, v52_reason, v52_meta = False, 'FET_PREEMPTION_V52_NOT_RUNNING', dict(
                    sha=v52_pin['sha'], serviceUnit=v52_pin['serviceUnit'], pid=0)
        else:
            v52_ok, v52_reason = True, ''
        result = evaluate(sha, approval, env, config_flag)
        if args.audit and not v52_ok:
            result['status'] = 'BLOCKED'
            if v52_reason not in result['reasons']:
                result['reasons'].append(v52_reason)
        if args.audit:
            result['v52Identity'] = v52_meta
    except (OSError, ValueError, subprocess.SubprocessError, json.JSONDecodeError):
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
