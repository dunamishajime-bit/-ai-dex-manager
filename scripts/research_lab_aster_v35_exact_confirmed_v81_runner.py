from __future__ import annotations

import research_lab_aster_v35_core_only_v37_runner as aster
import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_v35_exact_confirmed_nested_v81 as v81


_original_select = v81.v80.v79.select_config


def safe_select_config(
    candidates,
    normal_rows,
    severe_rows,
    train_start,
    validation_start,
    validation_end,
):
    selected, audit = _original_select(
        candidates,
        normal_rows,
        severe_rows,
        train_start,
        validation_start,
        validation_end,
    )
    if selected.config_id in normal_rows:
        return selected, audit
    selected = sorted(
        candidates,
        key=lambda config: (
            config.strong_mult,
            config.normal_mult,
            config.bear_mult,
            config.brake_mult,
            -config.dd_start,
        ),
    )[0]
    audit = dict(audit)
    audit["fallback"] = True
    audit["selected"] = selected.config_id
    audit["note"] = "Lowest-Gross current-set fallback; final OOS/statistical gates unchanged."
    return selected, audit


if __name__ == "__main__":
    v4.load_symbol = aster.load_aster_symbol
    v81.v80.v79.select_config = safe_select_config
    v81.main()
