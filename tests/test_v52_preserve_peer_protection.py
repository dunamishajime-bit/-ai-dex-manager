"""Exercise the V52 entry boundary without a venue client."""

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import disdex_v52_aster_only_live_engine as subject


class PreservePeerProtection(unittest.TestCase):
    def test_entry_uses_only_confirmed_capacity(self):
        for crypto, stock, pending, target, expected in (
            (1.0, 0.5, 0.0, 1.0, True),
            (2.0, 1.0, 0.0, 1.5, False),
            (3.0, 1.25, 0.0, 1.0, False),
            (0.25, 4.0, 0.0, 1.0, False),
            (2.0, 1.0, 0.5, 1.0, False),
        ):
            with self.subTest(crypto=crypto, stock=stock, pending=pending):
                engine = object.__new__(subject.V52AsterOnlyEngine)
                engine.live = True
                engine.v11_gross_cap = 2.0
                engine.gross_snapshot = Mock(return_value={
                    "equityUsd": 1000, "cryptoGross": crypto,
                    "stockGross": stock, "totalGross": crypto + stock,
                })
                engine.require_fresh_preorder_margin_guard = Mock()
                engine.log = Mock()
                for runner in ("idle_residual", "fet", "quality102", "v12_dynamic", "hype_zec"):
                    setattr(engine, f"_prepare_{runner}_for_stock_entry", Mock(
                        side_effect=AssertionError(f"unexpected {runner} preemption"),
                    ))
                with patch.object(subject, "aggregate_pending", return_value={
                    "cryptoGross": pending, "stockGross": 0.0,
                }), patch.object(subject.legacy.V52AsterOnlyEngine, "_submit_basis_position",
                                 return_value=True) as submit:
                    self.assertIs(engine.open_basis_position(subject.V11_SLOT, {}, target), expected)
                    self.assertEqual(submit.call_count, int(expected))
                    self.assertEqual(engine.require_fresh_preorder_margin_guard.call_count, int(expected))


if __name__ == "__main__":
    unittest.main()
