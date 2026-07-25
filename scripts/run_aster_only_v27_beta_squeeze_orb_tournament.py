from __future__ import annotations

import research_lab_aster_only_v27_beta_squeeze_orb_tournament as v27

_ORIGINAL_BUILD_TRADE = v27.build_trade


def build_trade_with_attribution(candidate, day, day_rows):
    row = _ORIGINAL_BUILD_TRADE(candidate, day, day_rows)
    if row is None:
        return None
    symbol = str(row["symbol"])
    side = int(row["side"])
    entry_ts = int(row["entryTs"])
    exit_ts = int(row["exitTs"])
    funding_return = (-side) * v27.v14.funding_mod.funding_between(
        day_rows[symbol]["fundingPoints"], entry_ts, exit_ts
    )
    row["fundingReturn"] = funding_return
    row["priceReturn"] = float(row["grossReturn"]) - funding_return
    return row


v27.build_trade = build_trade_with_attribution


if __name__ == "__main__":
    raise SystemExit(v27.main())
