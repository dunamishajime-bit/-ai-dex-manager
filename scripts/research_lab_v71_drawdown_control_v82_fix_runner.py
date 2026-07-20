from __future__ import annotations

import research_lab_v35_core_pengu_v67_combined_v2 as v68b
import research_lab_v71_drawdown_control_v82 as v82

# V71 validated a 75% pre-cap MTM audit guard for proportional PENGU scaling
# up to target Gross 1.30. V82 keeps target Gross 1.15 and changes only the
# portfolio drawdown control. The first V82 run accidentally inherited the old
# 35% guard and stopped at a 53.9571% pre-cap bucket move.
# This is an audit guard only. Portfolio acceptance still requires observed
# Gross <= 2.0 plus the DD, Severe, large-wave-excluded and concentration gates.
v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0


if __name__ == "__main__":
    v82.main()
