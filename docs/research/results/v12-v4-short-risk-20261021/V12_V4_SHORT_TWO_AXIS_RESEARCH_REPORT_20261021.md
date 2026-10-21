# V12 V4 SHORT: initial adverse loss + profit giveback guard

STATUS: RESEARCH_ONLY. No production order or trading stop changed.

## Exit policy

1. First-loss prevention: after 12 hours, if the largest prior favorable move has remained below +1%, and SHORT price is +2.5% adverse versus entry, exit. Cooldown: 12h for the same symbol and SHORT side ONLY after a real admitted stop (research evidence models this).
2. Profit protection: after the SHORT has achieved maximum favorable excursion at least +5%, if unrealized gain has fallen to +2% or less AND the two latest causally completed H1 candles confirm prices rising, buy to cover on the next modeled M5. This is NOT a guaranteed +2% actual fill.
3. Profit policy tested across V4 TIME37 SHORT only, early-stop policy V12 SHORT all routes. Keep the original emergency +8% TIME SHORT resident stop. Never change PENGU or unrelated logics.

## Economic BT (8 strategies integrated, 2025-08-10 through 2026-08-10, JPY 10,000 compounded)

| Case | 10bps final | 10bps MTM DD | 30bps final | 30bps MTM DD | Losing trades improved (10bps) | Winning trades harmed (10bps) |
|---|---:|---:|---:|---:|---:|---:|
| Original | ¥222,818,967 | -15.621% | ¥124,289,207 | -16.788% | - | - |
| Initial STOP 2.5%, 12h, MFE under1%, cooldown 12h | ¥204,448,513 | -14.796% | ¥91,181,051 | -15.412% | 13 | 19 |
| SHORT_PROFIT_2P_TO_0P5_BULL2 | ¥169,733,415 | -19.803% | ¥53,079,279 | -21.271% | 50 | 114 |
| SHORT_PROFIT_3P_TO_1P_BULL2 | ¥174,382,630 | -16.830% | ¥61,507,231 | -18.115% | 22 | 75 |
| SHORT_PROFIT_5P_TO_2P_BULL2 | ¥222,944,967 | -15.582% | ¥120,016,747 | -16.779% | 4 | 23 |
| SHORT_BOTH_2P5_AND_2P_TO_0P5 | ¥158,377,235 | -19.851% | ¥40,356,310 | -21.483% | 62 | 122 |
| SHORT_BOTH_2P5_AND_3P_TO_1P | ¥160,031,595 | -17.403% | ¥47,029,164 | -18.990% | 35 | 83 |
| SHORT_BOTH_2P5_AND_5P_TO_2P | ¥198,781,134 | -14.603% | ¥80,410,194 | -15.773% | 17 | 42 |

## Assessment

- Profit-only +5% to +2% with bullish H1x2 is less destructive than the tighter +2/+0.5 or +3/+1 variants.
- Combined initial 2.5% plus profit +5% to +2% improves portfolio MTM DD by +1.0173 percentage points at 10bps and +1.0147 points at 30bps against Original.
- BUT versus initial-stop-only, combined 30bps DD deteriorates from -15.412% to -15.773%; 30bps final capital preservation is only 64.7% of the original baseline. Thus the established formal economic gate would NOT pass.
- Consequently this is a risk-first conditional shortlist requiring explicit loss-of-profit acceptance and real venue plus holdout certification before Production. Do not label it production-adopted based on historical results.
- Adding the tighter two profit floors (+2% to +0.5%, +3% to +1%) harms DD significantly, alone and combined. Reject those configurations.

## Production safety

The current V4 TIME SHORT initial resident emergency stop is entry +8%. Any additional early exit or profit market close requires signed order ownership, persistent per-leg time/MFE and 2 H1 closed-candle evidence, safe stop cleanup only after actual exit, no duplicate orders, restart and partial-fill handling, shared risk and account-rate locks, exact release/operator approval, parity to the new independent Task9 allocator and a new unused holdout.

Model accounting PASS, source 8 logic allocator dynamically reran admission and capital; no signed exchange evidence. PENGU unchanged. LIVE and VPS unchanged.

Code: scripts/dd-reduction/run-task9-v4-short-two-axis-20261021.py
Unit checks: scripts/dd-reduction/test-v4-short-two-axis-20261021.py
Raw M5/H1 engine ledgers retained in local PC research output directory.
