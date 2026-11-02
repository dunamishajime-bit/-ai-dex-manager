"""Route-neutral constants and safety rules for DisDex deployment adapters."""

import re

REPO = "dunamishajime-bit/-ai-dex-manager"
DEPLOYMENT_TARGET = "professional-dismanager.net"
OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS"
CODEX_SSH_OPERATOR = "codex-ssh"
CODEX_SSH_AUTH_SCHEMA = "disdex-codex-ssh-root-auth/v1"
ROUTES = frozenset(("GITHUB_ACTIONS", "CODEX_SSH"))
SCOPES = frozenset((
    "FULL_PROJECT", "V12_V4", "QUALITY102_CAUSAL_V1", "V52", "PENGU_V8",
    "FET_BRK48_RESIDUAL", "HYPE_TREND_LONG", "IDLE_PRIORITY_SHORT",
    "SHARED_CRYPTO_RISK_ONLY", "MARGIN_GUARD_ONLY", "API_MONITORS", "HP_ONLY",
    "ROLLBACK", "V4_EVIDENCE_REFRESH_ONLY",
))
NO_ORDER_SCOPES = frozenset((
    "SHARED_CRYPTO_RISK_ONLY", "MARGIN_GUARD_ONLY", "API_MONITORS", "HP_ONLY", "ROLLBACK",
    "V4_EVIDENCE_REFRESH_ONLY",
))
SHA = re.compile(r"[0-9a-f]{40}\Z")
PLAN_HASH = re.compile(r"[0-9a-f]{64}\Z")


def validate_order_permission(scope, orders_enabled):
    """Reject implicit or unsafe order authority for a deployment scope."""
    if type(orders_enabled) is not bool:
        raise ValueError("order permission must be boolean")
    if scope in NO_ORDER_SCOPES and orders_enabled:
        raise ValueError("order permission is not allowed for this scope")
