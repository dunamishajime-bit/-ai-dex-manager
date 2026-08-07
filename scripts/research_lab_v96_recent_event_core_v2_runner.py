from pathlib import Path

import research_lab_v96_recent_event_core_v2 as v2


_original_load_aster_symbol = v2.core.load_aster_symbol
_cache_root = Path.cwd() / ".cache" / "perp-research-usdm"


def _one_arg_loader(symbol: str):
    return _original_load_aster_symbol(_cache_root, symbol)


v2.core.load_aster_symbol = _one_arg_loader


if __name__ == "__main__":
    v2.main()
