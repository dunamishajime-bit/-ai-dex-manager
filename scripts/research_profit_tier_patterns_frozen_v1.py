"""Frozen Profit-Tier Entry Patterns V1.

Copied exactly from Profit Tier Pattern Discovery V1 AFTER applying the already-frozen
Loss-Only Entry Firewall V1 and BEFORE the first Profit+Loss candidate backtest.
Do not modify these patterns from the same historical backtest result.
"""
from __future__ import annotations

PROFIT_PATTERN_ID="PROFIT_TIER_PATTERNS_V1"
DISCOVERY_RUN_ID=31911816597
DISCOVERY_ARTIFACT_ID=9253879726
DISCOVERY_ARTIFACT_DIGEST="sha256:0f78c8987524ad8e98d23e81210315c2c164b7a2c1d4d17a793b30421b8fdf71"
DISCOVERY_SOURCE_BLOB="0581e1bc5898c7e3c9954d63a03f2482d1dd4c25"
P33_RETURN_PCT=0.359951329427676
P67_RETURN_PCT=1.430715273865041

BIG_PATTERNS=(
    ("sideRelative72","STRONG_WITH"),
    ("extensionState","EXTENDED_CHASE"),
)
MEDIUM_PATTERNS=(
    ("horizonState","LONG_HORIZON_COUNTER"),
    ("sideRelative72","WITH"),
)
SMALL_PATTERNS=(
    ("sideRelative24","NEUTRAL"),
    ("extensionState","NOT_EXTENDED"),
    ("volState","COMPRESSED"),
    ("sideZ24","WITH"),
    ("volPathState","OTHER"),
)

WEIGHTS={"BIG":4,"MEDIUM":2,"SMALL":1}
MIN_SCORE=4
REQUIRE_BIG=True


def matched(features:dict):
    out={"BIG":[],"MEDIUM":[],"SMALL":[]}
    for tier,patterns in (("BIG",BIG_PATTERNS),("MEDIUM",MEDIUM_PATTERNS),("SMALL",SMALL_PATTERNS)):
        for k,v in patterns:
            if features.get(k)==v:out[tier].append(f"{k}={v}")
    return out


def score(features:dict):
    m=matched(features)
    s=sum(WEIGHTS[tier]*len(m[tier]) for tier in m)
    return s,m


def qualifies(features:dict):
    s,m=score(features)
    return (bool(m["BIG"]) if REQUIRE_BIG else True) and s>=MIN_SCORE

FROZEN_BEFORE_CANDIDATE_BACKTEST=True
LOSS_FIREWALL_MUST_PASS=True
PAIR_SPECIFIC_PARAMETERS=False
PARAMETER_GRID=False
FRESH_OOS_READ=False
PRODUCTION_CHANGED=False
VPS_CHANGED=False
LIVE_CHANGED=False
REAL_TRADING_ENABLED=False
