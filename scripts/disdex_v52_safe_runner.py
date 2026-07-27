from __future__ import annotations

from typing import Any

import disdex_v52_aster_only_live_engine as engine
import disdex_v52_execution_safety_patch as safety


def install_postfill_aware_gross_recheck(cls: Any) -> None:
    """Avoid treating an already-filled position as a second proposed entry."""

    original = cls.recheck_entry_conditions

    def recheck(self: Any, candidate: dict, *args: Any, **kwargs: Any):
        pending = self.state.get("pendingOrder") or {}
        if (
            self.live
            and pending.get("action") == "OPEN"
            and safety._finite(candidate.get("expectedGross")) > 0
        ):
            symbol = str(candidate.get("symbol") or "")
            aster_symbol = engine.base.ASTER_SYMBOL.get(symbol)
            actual = (
                safety._finite(
                    self.managed_aster_positions().get(aster_symbol),
                )
                if aster_symbol
                else 0.0
            )
            if abs(actual) > 1e-12:
                postfill_candidate = dict(candidate)
                postfill_candidate["expectedGross"] = 0.0
                result = original(
                    self,
                    postfill_candidate,
                    *args,
                    **kwargs,
                )
                gross_snapshot = self.gross_snapshot()
                self.assert_gross_safe(gross_snapshot)
                result["grossSnapshot"] = gross_snapshot
                result["grossCheckMode"] = "POST_FILL_EXISTING_POSITION"
                self.log(
                    "entry-recheck-post-fill-gross",
                    symbol=symbol,
                    actualPositionQty=actual,
                    grossSnapshot=gross_snapshot,
                )
                return result
        return original(self, candidate, *args, **kwargs)

    cls.recheck_entry_conditions = recheck


safety.install_class(engine.V52AsterOnlyEngine)
install_postfill_aware_gross_recheck(engine.V52AsterOnlyEngine)


if __name__ == "__main__":
    raise SystemExit(engine.main())
