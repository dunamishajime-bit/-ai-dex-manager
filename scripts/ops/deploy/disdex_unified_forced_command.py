#!/usr/bin/env python3
"""authorized_keys forced-command dispatcher; no arbitrary shell allowed."""
import os
import re
import shlex
import sys

from disdex_deployment_contract import CODEX_SSH_OPERATOR

HELPER = "/usr/local/sbin/disdex-unified-production-deploy"
READINESS_HELPER = "/usr/local/sbin/disdex-v4-live-readiness"
IDLE_FLAT_REPAIR_HELPER = "/usr/local/sbin/disdex-idle-residual-flat-stale-repair"
IDLE_FLAT_REPAIR_ARGV = [IDLE_FLAT_REPAIR_HELPER, "--execute-after-three-signed-gets"]
IDLE_KILL_RECOVERY_HELPER = "/usr/local/sbin/disdex-idle-residual-kill-recovery"
IDLE_KILL_RECOVERY_ARGV = [IDLE_KILL_RECOVERY_HELPER, "--execute-after-three-signed-gets"]
STATIC_EVIDENCE_HELPER = "/usr/local/sbin/disdex-v4-static-evidence"
REFRESH_HELPER = "/usr/local/sbin/disdex-v4-evidence-refresh-activate"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PLAN_RE = re.compile(r"^[0-9a-f]{64}$")
LOGIN_RE = re.compile(r"^[A-Za-z0-9-]{1,39}$")
ALLOWED = (
    "--deployment-target", "--operator-target", "--sha", "--scope",
    "--plan-sha256", "--orders-enabled", "--route", "--owner",
)
MODES = ("--preflight-readonly", "--execute")

def parse_original(value):
    argv = shlex.split(value, posix=True)
    if argv == [READINESS_HELPER]:
        return argv
    if argv == IDLE_FLAT_REPAIR_ARGV:
        return argv
    if argv == IDLE_KILL_RECOVERY_ARGV:
        return argv
    if (len(argv) == 3 and argv[0] == STATIC_EVIDENCE_HELPER
            and argv[1] == "--sha" and SHA_RE.fullmatch(argv[2] or "")):
        return argv
    if (len(argv) == 11 and argv[0] == REFRESH_HELPER
            and argv[1] == "--install"
            and argv[2] == "--sha" and SHA_RE.fullmatch(argv[3] or "")
            and argv[4] == "--operator" and LOGIN_RE.fullmatch(argv[5] or "")
            and argv[6] == "--route"
            and argv[8] == "--plan-sha256" and PLAN_RE.fullmatch(argv[9] or "")):
        if argv[7] == "GITHUB_ACTIONS" and argv[10] == "--token-stdin":
            return argv
        if (argv[7] == "CODEX_SSH" and argv[5] == CODEX_SSH_OPERATOR
                and argv[10] == "--codex-ssh"):
            return argv
        raise ValueError("invalid refresh authorization route")
    if not argv or argv[0] != HELPER:
        raise ValueError("invalid forced-command target")
    if len(argv) != 1 + len(ALLOWED) * 2 + 2:
        raise ValueError("forced-command argument count")
    arguments = argv[1:]
    mode_index = len(ALLOWED) * 2
    if arguments[mode_index] not in MODES:
        raise ValueError("invalid forced-command mode")
    terminal_flag = arguments[mode_index + 1]
    for index, field in enumerate(ALLOWED):
        if arguments[2 * index] != field:
            raise ValueError("invalid forced-command flag order")
        value = arguments[2 * index + 1]
        if not value or len(value) > 128 or value.startswith("-"):
            raise ValueError("invalid forced-command argument")
    route = arguments[2 * ALLOWED.index("--route") + 1]
    owner = arguments[2 * ALLOWED.index("--owner") + 1]
    if terminal_flag == "--read-approval-stdin":
        if route != "GITHUB_ACTIONS":
            raise ValueError("signed approval route mismatch")
    elif terminal_flag == "--codex-ssh":
        if route != "CODEX_SSH" or owner != CODEX_SSH_OPERATOR:
            raise ValueError("invalid Codex SSH authorization")
    else:
        raise ValueError("invalid forced-command authorization mode")
    return argv

def main():
    try:
        command = parse_original(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
        if command == [READINESS_HELPER]:
            target = READINESS_HELPER
        elif command == IDLE_FLAT_REPAIR_ARGV:
            target = IDLE_FLAT_REPAIR_HELPER
        elif command == IDLE_KILL_RECOVERY_ARGV:
            target = IDLE_KILL_RECOVERY_HELPER
        elif command and command[0] == STATIC_EVIDENCE_HELPER:
            target = STATIC_EVIDENCE_HELPER
        elif command and command[0] == REFRESH_HELPER:
            target = REFRESH_HELPER
        else:
            target = HELPER
        os.execv(target, command)
    except (ValueError, OSError) as e:
        print("DISDEX_FORCED_COMMAND_BLOCKED:" + str(e), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
