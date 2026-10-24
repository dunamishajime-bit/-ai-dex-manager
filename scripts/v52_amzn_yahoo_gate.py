"""Production import surface for the AMZN-only Yahoo gate.

The deterministic implementation lives beside its research contract under
``scripts/dd-reduction`` so the exact evaluator can be tested independently.
This thin loader keeps the live runner's import path within ``scripts/`` and
does not execute any network request at import time.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path


_IMPLEMENTATION = Path(__file__).resolve().parent / "dd-reduction" / "v52_amzn_yahoo_gate.py"
_SPEC = importlib.util.spec_from_file_location("_v52_amzn_yahoo_gate_impl", _IMPLEMENTATION)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"V52 AMZN Yahoo gate implementation unavailable: {_IMPLEMENTATION}")
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)

evaluate_amzn_short_yahoo_gate = _MODULE.evaluate_amzn_short_yahoo_gate
evaluate_live_amzn_short_yahoo_gate = _MODULE.evaluate_live_amzn_short_yahoo_gate
fetch_yahoo_h1_bars = _MODULE.fetch_yahoo_h1_bars
normalize_yahoo_h1_bars = _MODULE.normalize_yahoo_h1_bars
is_nyse_session_date = _MODULE.is_nyse_session_date

__all__ = [
    "evaluate_amzn_short_yahoo_gate",
    "evaluate_live_amzn_short_yahoo_gate",
    "fetch_yahoo_h1_bars",
    "normalize_yahoo_h1_bars",
    "is_nyse_session_date",
]
