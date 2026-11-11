# HYPE pre-target chronological split audit — 2026-11-11

Hajime Remote resumed successfully. Git worktree clean at 6c79faea before this file.

Data: Binance UM pre-target proxy pinned HYPE entry and validated M5 exit; 39 candidates, no unresolved. 10bps/30bps are standalone round-trip cost models applied to rawReturn, not a live Aster fill reconstruction.

| Chronological slice | n | wins | win rate | mean 10bps | PF 10bps | mean 30bps | PF 30bps |
|---|---:|---:|---:|---:|---:|---:|---:|
| June–July 2025 TRAIN | 19 | 9 | 47.37% | +1.296% | 2.652 | +1.096% | 2.232 |
| August 2025 VALID | 11 | 0 | 0.00% | -1.664% | 0 | -1.864% | 0 |
| September 2025 PREHOLD | 9 | 2 | 22.22% | -0.158% | 0.847 | -0.358% | 0.699 |

Critical result: August 11/11 losses at both cost levels, with September also weak. Do not claim profitability from June–July train alone. No new HYPE gate is adopted. Any feature threshold must be learned from train only and independently falsified in validation and prehold; small samples need conservative uncertainty bounds. Next: train-only feature gate search and true forward Aster holdout where available. Do not tune on target year.

No production code, orders, STOP, Runner, Kill Switch or live state modified.
