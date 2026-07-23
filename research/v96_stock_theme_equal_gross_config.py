from __future__ import annotations

CRYPTO_GROSS_CAP = 1.0
STOCK_GROSS_CAP = 1.0
PORTFOLIO_GROSS_CAP = 2.0
STOCK_DIRECTIONAL_GROSS = 1.0
STOCK_NEUTRAL_LONG_GROSS = 0.5
STOCK_NEUTRAL_SHORT_GROSS = 0.5

ALLOCATION_ID = "V96_CRYPTO_1_STOCK_1_EQUAL_GROSS_V1"
EFFECTIVE_FROM_UTC = "2026-07-23T00:00:00Z"


def allocation_manifest() -> dict:
    return {
        "allocationId": ALLOCATION_ID,
        "effectiveFromUtc": EFFECTIVE_FROM_UTC,
        "researchAllocation": {
            "cryptoGrossCap": CRYPTO_GROSS_CAP,
            "stockGrossCap": STOCK_GROSS_CAP,
            "portfolioGrossCap": PORTFOLIO_GROSS_CAP,
            "stockDirectionalGross": STOCK_DIRECTIONAL_GROSS,
            "stockNeutralLongGross": STOCK_NEUTRAL_LONG_GROSS,
            "stockNeutralShortGross": STOCK_NEUTRAL_SHORT_GROSS,
        },
        "operation": {
            "cryptoEngineHours": "24H",
            "stockEngineHours": "US_MARKET_SESSION_ONLY",
            "capitalTransferBetweenSleeves": False,
        },
        "safety": {
            "mode": "SHADOW_RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "currentProductionV96WeightsChanged": False,
        },
        "legacyAllocation": {
            "cryptoGross": 1.9,
            "stockGross": 0.1,
            "status": "LEGACY_REFERENCE_ONLY",
        },
    }


def self_test() -> None:
    assert CRYPTO_GROSS_CAP + STOCK_GROSS_CAP == PORTFOLIO_GROSS_CAP
    assert STOCK_NEUTRAL_LONG_GROSS + STOCK_NEUTRAL_SHORT_GROSS == STOCK_GROSS_CAP
    assert allocation_manifest()["safety"]["orderSubmissionAllowed"] is False


if __name__ == "__main__":
    self_test()
    print("Equal-gross allocation self-test: PASS")
