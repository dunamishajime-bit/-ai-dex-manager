# Current Stock historical-BT limitations

The historical backtest has not started yet because the Forward sample is still being used to freeze the final entry, exit, holding-period and executable-cost rules.

Already fixed:
- Crypto Gross 1.0 / Stock Gross 1.0 / total Gross 2.0.
- Crypto remains eligible 24 hours.
- Stock is an additive U.S.-regular-session overlay.
- Hard time slicing is rejected.
- Sleeve lending is disabled for the initial comparison.
- News is a risk-data overlay, not a direction selector.

Still required before the authoritative BT:
- final Stock signal choice;
- exact entry and exit timing;
- holding period;
- final executable-symbol filter;
- Forward-observed Normal cost model;
- Severe cost model;
- handling of Aster listing-history gaps versus underlying-equity history.
