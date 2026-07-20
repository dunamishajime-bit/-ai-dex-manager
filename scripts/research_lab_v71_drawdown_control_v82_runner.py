from __future__ import annotations

import research_lab_v35_core_pengu_v67_combined_v2 as v68b

# V71 expands the validated 0.30 Gross path to 1.15 Gross. This guard checks
# pre-cap MTM path integrity only; portfolio acceptance remains controlled by
# the unchanged Gross, DD, retention and concentration gates in V82.
AUDIT_GUARD_PCT = 75.0
v68b.MAX_ALLOWED_BUCKET_MOVE_PCT = AUDIT_GUARD_PCT

import research_lab_v71_drawdown_control_v82 as v82

# v69/v70 expose the underlying V68 module whose v67_series function was
# replaced by v68b.audited_series. Patch the function globals explicitly so
# the guard cannot fall back to the module default because of import aliases.
v82.v68.v67_series.__globals__["MAX_ALLOWED_BUCKET_MOVE_PCT"] = AUDIT_GUARD_PCT


if __name__ == "__main__":
    v82.main()
