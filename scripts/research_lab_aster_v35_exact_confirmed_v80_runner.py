from __future__ import annotations

import research_lab_aster_v35_core_only_v37_runner as aster
import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_v35_exact_confirmed_nested_v80 as v80


if __name__ == "__main__":
    v4.load_symbol = aster.load_aster_symbol
    v80.main()
