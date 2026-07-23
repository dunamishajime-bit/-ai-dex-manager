from __future__ import annotations

import disdex_v95_golden_vector_generator as v95


# The controller algorithm is unchanged; only the frozen V96 portfolio
# rebalance threshold differs from the historical V95 baseline.
v95.PORTFOLIO_TURNOVER_THRESHOLD = 0.075


if __name__ == "__main__":
    if abs(v95.WEIGHT_TOLERANCE - 0.05) > 1e-12:
        raise SystemExit("Unexpected V96 Weight Band tolerance")
    if abs(v95.PORTFOLIO_TURNOVER_THRESHOLD - 0.075) > 1e-12:
        raise SystemExit("Unexpected V96 portfolio threshold")
    if v95.MAXIMUM_STALE_BARS != 12:
        raise SystemExit("Unexpected V96 forced-refresh bars")
    v95.main()
