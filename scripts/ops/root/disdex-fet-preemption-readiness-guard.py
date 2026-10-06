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
            unit = 'disdex-v52-aster-only@' + sha + '.service'
            pid = subprocess.check_output(['systemctl', 'show', unit, '-p', 'MainPID', '--value'], text=True).strip()
            v52_running = pid.isdigit() and int(pid) > 0
            if v52_running:
                # A running service is authoritative for its effective environment.
                env = {k: v for k, v in (x.split('=', 1) for x in Path('/proc', pid, 'environ').read_bytes().decode().split(chr(0)) if '=' in x)
                       if k in ('DISDEX_RUNTIME_COMMIT_SHA', 'FET_BRK48_CORE_PREEMPTION_READY')}
            else:
                env = config_env
        result = evaluate(sha, approval, env, config_flag)
        if args.audit and not v52_running and result['status'] == 'HEALTHY':
            result['status'] = 'BLOCKED'
            result['reasons'].append('FET_PREEMPTION_V52_NOT_RUNNING')
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
