from __future__ import annotations

import research_lab_aster_microstructure_v17 as v17


EXTRA_SYMBOLS = ["PENGUUSDT"]
for symbol in EXTRA_SYMBOLS:
    if symbol not in v17.SYMBOLS:
        v17.SYMBOLS.append(symbol)


if __name__ == "__main__":
    v17.main()
