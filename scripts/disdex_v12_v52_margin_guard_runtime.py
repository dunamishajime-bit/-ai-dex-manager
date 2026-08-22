from __future__ import annotations

# Bootstrap the existing serialized V96/V52 Margin Guard with the frozen V12
# universe.  The legacy modules are intentionally left untouched so the
# currently deployed V96 composition keeps its exact production contract until
# the migration is executed.
import disdex_v96_v52_margin_guard as guard

V12_CRYPTO_SYMBOLS = (
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
)

guard.MANAGED_CRYPTO_SYMBOLS = V12_CRYPTO_SYMBOLS
guard.MANAGED_SYMBOLS = V12_CRYPTO_SYMBOLS + guard.MANAGED_STOCK_SYMBOLS

import disdex_v96_v52_margin_guard_runtime as runtime  # noqa: E402

runtime.MANAGED_SYMBOLS = guard.MANAGED_SYMBOLS
_original_self_test = runtime.self_test


def v12_self_test() -> None:
    _original_self_test()
    assert len(V12_CRYPTO_SYMBOLS) == 15
    assert "LINKUSDT" in runtime.MANAGED_SYMBOLS
    assert "NEARUSDT" in runtime.MANAGED_SYMBOLS
    assert "PENGUUSDT" in runtime.MANAGED_SYMBOLS
    assert len(set(runtime.MANAGED_SYMBOLS)) == len(runtime.MANAGED_SYMBOLS)
    print("V12/PENGU/V52 serialized Margin Guard universe self-test: PASS")


runtime.self_test = v12_self_test


if __name__ == "__main__":
    raise SystemExit(runtime.main())
