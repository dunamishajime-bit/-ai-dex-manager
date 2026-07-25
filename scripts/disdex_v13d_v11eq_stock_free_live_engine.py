from __future__ import annotations

import os

import disdex_v13d_v11eq_stock_live_engine as engine

# The free Pyth Core + Alpaca IEX reference is deliberately held to wider
# minimum edge floors than the consolidated SIP configuration.
engine.V13D_MIN_PROJECTED_NET_BPS = float(os.getenv("DISDEX_V13D_MIN_PROJECTED_NET_BPS", "10"))
engine.V11_MIN_NET_EDGE_BPS = float(os.getenv("DISDEX_V11EQ_MIN_NET_EDGE_BPS", "20"))


if __name__ == "__main__":
    raise SystemExit(engine.main())
