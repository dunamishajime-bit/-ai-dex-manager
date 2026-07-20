from __future__ import annotations

import research_lab_pengu_wave_sleeve_v53 as v53


_original_run_candidate = v53.v50.run_candidate


def _trades_only(*args, **kwargs):
    trades, _armed_without_order = _original_run_candidate(*args, **kwargs)
    return trades


v53.v50.run_candidate = _trades_only


if __name__ == "__main__":
    v53.main()
