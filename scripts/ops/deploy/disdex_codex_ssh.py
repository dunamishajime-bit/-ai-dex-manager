#!/usr/bin/env python3
"""Safe Codex direct-SSH adapter for the shared DisDex deployment contract.

This adapter never accepts a shell command.  It passes the owner-signed token
over stdin to the same root-owned VPS helper used by the GitHub Actions route.
The helper, not this client, remains the authority for venue/STOP/risk and
production mutation gates.
"""
import argparse
import subprocess
import sys

from disdex_deployment_contract import (
    DEPLOYMENT_TARGET,
    OPERATOR_TARGET,
    PLAN_HASH,
    SCOPES,
    SHA,
    validate_order_permission,
)

REMOTE_HELPER = "/usr/local/sbin/disdex-unified-production-deploy"
REFRESH_REMOTE_HELPER = "/usr/local/sbin/disdex-v4-evidence-refresh-activate"
CODEX_ROUTE = "CODEX_SSH"


def _validate_inputs(host, identity_file, known_hosts, port, sha, scope,
                     plan_sha256, orders_enabled, owner):
    if host != DEPLOYMENT_TARGET:
        raise ValueError("deployment host must match the canonical target")
    if not identity_file or not known_hosts:
        raise ValueError("identity and known-host files are required")
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("invalid SSH port")
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("invalid SHA")
    if scope not in SCOPES:
        raise ValueError("invalid deployment scope")
    if not isinstance(plan_sha256, str) or not PLAN_HASH.fullmatch(plan_sha256):
        raise ValueError("invalid plan hash")
    validate_order_permission(scope, orders_enabled)
    if not isinstance(owner, str) or not owner or len(owner) > 39 or not owner.replace('-', '').isalnum():
        raise ValueError('invalid owner')


def build_ssh_command(*, host, identity_file, known_hosts, port, sha, scope,
                      plan_sha256, orders_enabled, owner):
    _validate_inputs(host, identity_file, known_hosts, port, sha, scope,
                     plan_sha256, orders_enabled, owner)
    if scope == "V4_EVIDENCE_REFRESH_ONLY":
        return [
            "ssh", "-T", "-i", identity_file,
            "-o", "IdentitiesOnly=yes",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=yes",
            "-o", f"UserKnownHostsFile={known_hosts}",
            "-p", str(port),
            f"root@{host}",
            REFRESH_REMOTE_HELPER,
            "--install",
            "--sha", sha,
            "--operator", owner,
            "--route", CODEX_ROUTE,
            "--plan-sha256", plan_sha256,
            "--token-stdin",
        ]
    return [
        "ssh", "-T", "-i", identity_file,
        "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", f"UserKnownHostsFile={known_hosts}",
        "-p", str(port),
        f"root@{host}",
        REMOTE_HELPER,
        "--deployment-target", DEPLOYMENT_TARGET,
        "--operator-target", OPERATOR_TARGET,
        "--sha", sha,
        "--scope", scope,
        "--plan-sha256", plan_sha256,
        "--orders-enabled", str(orders_enabled).lower(),
        "--route", CODEX_ROUTE,
        "--owner", owner,
        "--execute",
        "--read-approval-stdin",
    ]


def run(args):
    token = sys.stdin.read()
    if not token or len(token) > 16384:
        raise ValueError("owner approval token must be supplied on stdin")
    command = build_ssh_command(
        host=args.host,
        identity_file=args.identity_file,
        known_hosts=args.known_hosts,
        port=args.port,
        sha=args.sha,
        scope=args.scope,
        plan_sha256=args.plan_sha256,
        orders_enabled=args.orders_enabled == "true",
        owner=args.owner,
    )
    return subprocess.run(command, input=token, text=True, check=False).returncode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEPLOYMENT_TARGET)
    parser.add_argument("--identity-file", required=True)
    parser.add_argument("--known-hosts", required=True)
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--scope", required=True, choices=sorted(SCOPES))
    parser.add_argument("--plan-sha256", required=True)
    parser.add_argument("--orders-enabled", required=True, choices=("true", "false"))
    parser.add_argument("--owner", required=True)
    args = parser.parse_args()
    try:
        return run(args)
    except (OSError, ValueError) as error:
        print("DISDEX_CODEX_SSH_DEPLOY_BLOCKED: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
