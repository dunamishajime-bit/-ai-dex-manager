#!/usr/bin/env python3
"""authorized_keys forced-command dispatcher; no arbitrary shell allowed."""
import os
import shlex
import sys

HELPER = "/usr/local/sbin/disdex-unified-production-deploy"
READINESS_HELPER = "/usr/local/sbin/disdex-v4-live-readiness"
ALLOWED = (
    "--deployment-target", "--operator-target", "--sha", "--scope",
    "--plan-sha256", "--orders-enabled", "--route", "--owner",
)
MODES = ("--preflight-readonly", "--execute")

def parse_original(value):
    argv = shlex.split(value, posix=True)
    if argv == [READINESS_HELPER]:
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
        target = READINESS_HELPER if command == [READINESS_HELPER] else HELPER
        os.execv(target, command)
    except (ValueError, OSError) as e:
        print("DISDEX_FORCED_COMMAND_BLOCKED:" + str(e), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
