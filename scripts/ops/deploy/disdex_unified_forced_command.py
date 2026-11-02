#!/usr/bin/env python3
"""authorized_keys forced-command dispatcher; no arbitrary shell allowed."""
import os
import shlex
import sys

HELPER = "/usr/local/sbin/disdex-unified-production-deploy"
READINESS_HELPER = "/usr/local/sbin/disdex-v4-live-readiness"
IDLE_FLAT_REPAIR_HELPER = "/usr/local/sbin/disdex-idle-residual-flat-stale-repair"
IDLE_FLAT_REPAIR_ARGV = [IDLE_FLAT_REPAIR_HELPER, "--execute-after-three-signed-gets"]
IDLE_KILL_RECOVERY_HELPER = "/usr/local/sbin/disdex-idle-residual-kill-recovery"
IDLE_KILL_RECOVERY_ARGV = [IDLE_KILL_RECOVERY_HELPER, "--execute-after-three-signed-gets"]
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
    if not argv or argv[0] != HELPER:
        raise ValueError("invalid forced-command target")
    if len(argv) != 1 + len(ALLOWED) * 2 + 2:
        raise ValueError("forced-command argument count")
    arguments = argv[1:]
    mode_index = len(ALLOWED) * 2
    if arguments[mode_index] not in MODES:
        raise ValueError("invalid forced-command mode")
    if arguments[mode_index + 1] != "--read-approval-stdin":
        raise ValueError("missing required signed approval flag")
    for index, field in enumerate(ALLOWED):
        if arguments[2 * index] != field:
            raise ValueError("invalid forced-command flag order")
        value = arguments[2 * index + 1]
        if not value or len(value) > 128 or value.startswith("-"):
            raise ValueError("invalid forced-command argument")
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
        else:
            target = HELPER
        os.execv(target, command)
    except (ValueError, OSError) as e:
        print("DISDEX_FORCED_COMMAND_BLOCKED:" + str(e), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
