from __future__ import annotations

import research_lab_v71_drawdown_control_v82 as v82

# V71 already validated this as a pre-cap MTM audit guard for the 1.15 Gross path.
# This is not a portfolio DD or acceptance limit. The real gates remain Gross <=2.0,
# return-retention, drawdown, Severe, concentration and clip-ratio constraints.
v82.v68.MAX_ALLOWED_BUCKET_MOVE_PCT = 75.0


if __name__ == "__main__":
    v82.main()
