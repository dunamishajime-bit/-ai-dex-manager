from __future__ import annotations

import disdex_v52_aster_only_live_engine as engine
import disdex_v52_execution_safety_patch as safety


safety.install_class(engine.V52AsterOnlyEngine)


if __name__ == "__main__":
    raise SystemExit(engine.main())
