"""Frozen Loss-Only Entry Firewall V1.

This file is created after loser-only Discovery/Validation and BEFORE any winner
collateral evaluation. The blocker set is copied exactly from artifact
loss-only-firewall-discovery-v2, run 31910652599, artifact 9253569536,
digest sha256:c255a514b1d06fc1854884498b7bfa4bca0e4c0d208d705f9994ccd26714edda.

Do not alter this blocker set based on winner collateral or candidate performance.
"""
from __future__ import annotations

FIREWALL_ID = "LOSS_ONLY_ENTRY_FIREWALL_V1"
DISCOVERY_RUN_ID = 31910652599
DISCOVERY_ARTIFACT_ID = 9253569536
DISCOVERY_ARTIFACT_DIGEST = "sha256:c255a514b1d06fc1854884498b7bfa4bca0e4c0d208d705f9994ccd26714edda"
DISCOVERY_SOURCE_BLOB = "a7e4999f18e3bf6ad67c291a5dc43843feaf01b8"

# Exact loser-only accepted blockers, in frozen ranking order.
BLOCKERS = (
    ("sideZ24", "STRONG_AGAINST"),
    ("sideBTC24", "AGAINST"),
    ("rangeState", "OPPOSITE_EXTREME"),
    ("sideZ72", "STRONG_AGAINST"),
    ("sideRelative72", "NEUTRAL"),
    ("breadthState", "AGAINST_SIDE"),
    ("volState", "NORMAL"),
    ("microState", "OTHER"),
)


def matched_blockers(features: dict) -> list[str]:
    return [f"{k}={v}" for k, v in BLOCKERS if features.get(k) == v]


def blocked(features: dict) -> bool:
    return bool(matched_blockers(features))


FROZEN_BEFORE_WINNER_EVALUATION = True
WINNER_FEATURES_USED_TO_SELECT_BLOCKERS = False
PRODUCTION_CHANGED = False
VPS_CHANGED = False
LIVE_CHANGED = False
REAL_TRADING_ENABLED = False
FRESH_OOS_READ = False
