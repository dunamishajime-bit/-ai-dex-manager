from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Tuple

BACKTEST_POLICY_ID = "V96_STOCK_HISTORICAL_BT_POLICY_V1"


@dataclass(frozen=True)
class HistoricalBacktestPolicy:
    price_source: str = "ASTER_STOCK_PERPETUAL_1H_WHEN_AVAILABLE"
    fallback_price_source: str = "UNDERLYING_US_EQUITY_1H_WITH_EXPLICIT_BASIS_LIMITATION"
    execution_session: str = "CONFIRMED_US_REGULAR_SESSION_ONLY"
    stock_gross_cap: float = 1.0
    directional_gross: float = 1.0
    neutral_long_gross: float = 0.5
    neutral_short_gross: float = 0.5
    normal_turnover_bps: float = 20.0
    severe_turnover_bps: float = 50.0
    use_forward_observed_cost_model: bool = True
    use_forward_event_data_as_historical_truth: bool = False
    use_article_sentiment_for_direction: bool = False
    prohibit_lookahead: bool = True
    require_walk_forward: bool = True
    require_year_by_year_results: bool = True
    require_delisted_symbol_review: bool = True
    minimum_regimes: Tuple[str, ...] = (
        "BULL",
        "BEAR",
        "HIGH_VOLATILITY",
        "LOW_VOLATILITY",
    )

    def to_dict(self) -> dict:
        return asdict(self)


def required_outputs() -> tuple[str, ...]:
    return (
        "netReturn",
        "cagr",
        "winRate",
        "profitFactor",
        "maxDrawdown",
        "returnToDrawdown",
        "averageWin",
        "averageLoss",
        "tradeCount",
        "turnoverCost",
        "fundingCost",
        "normalCostResult",
        "forwardObservedCostResult",
        "severeCostResult",
        "yearByYearResult",
        "walkForwardDevelopmentValidationHoldout",
        "symbolContribution",
        "largestTradeRemoved",
        "largestMonthRemoved",
        "regimeBreakdown",
    )


def interpretation() -> dict:
    return {
        "allowed": (
            "Estimate historical profitability and a plausible forward return range after the entry, exit, "
            "session, universe and cost rules are frozen."
        ),
        "forbidden": (
            "Treat a historical backtest as a guarantee, use current Forward event observations as if they "
            "were known historically, or retune rules on the final Holdout."
        ),
        "forwardDataRole": (
            "Calibrate executable spread, depth, slippage, session and rejection assumptions; not select "
            "historical winners after observing their returns."
        ),
    }


def self_test() -> None:
    policy = HistoricalBacktestPolicy()
    assert policy.stock_gross_cap == 1.0
    assert policy.neutral_long_gross + policy.neutral_short_gross == policy.stock_gross_cap
    assert policy.prohibit_lookahead is True
    assert policy.use_forward_event_data_as_historical_truth is False
    assert "maxDrawdown" in required_outputs()


if __name__ == "__main__":
    self_test()
    print("Stock historical backtest policy self-test: PASS")
