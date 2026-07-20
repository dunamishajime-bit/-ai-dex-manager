from __future__ import annotations

import research_lab_aster_v35_core_only_v37_runner as aster
import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_v35_exact_core_nested_overlay_v79 as v79


if __name__ == "__main__":
    v4.load_symbol = aster.load_aster_symbol
    v79.main()
