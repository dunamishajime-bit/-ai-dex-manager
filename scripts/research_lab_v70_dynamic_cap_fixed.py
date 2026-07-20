from __future__ import annotations

import research_lab_v35_core_pengu_v67_v70_dynamic_cap as v70

# V68b's 35% MTM guard was calibrated for 30% PENGU Gross.
# V70 evaluates up to 80%, where the same valid path scales above 35%.
# Portfolio Gross, DD, Severe DD, and minimum clip ratio remain the acceptance gates.
v70.v69.v68.MAX_ALLOWED_BUCKET_MOVE_PCT = 45.0


if __name__ == "__main__":
    v70.main()
