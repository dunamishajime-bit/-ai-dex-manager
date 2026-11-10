# Effective current implementation + research gate audit — 2026-11-11

## Verdict

The earlier PRODUCTION_LOGIC_PARITY_AUDIT_20261110.md at commit b1dba30... remains useful as an audit trail, but its headline 847-fill result is superseded for current-effective comparison.

The new baseline follows the effective runtime observed on VPS, not the separate future/formal order-enable contract:

- Crypto Gross: **3.0x**
- Stock Gross: **4.0x**
- Total Gross: **4.25x**
- Shared crypto daily loss: **7.5%**
- V4 aggregate: **2.0x**
- V4 per-position: **1.0x**
- Q102 maximum gross: **3.0x**
- HYPE maximum gross: **1.5x**
- FET maximum gross: **1.0x**, minimum residual **0.05x**
- V52 V11 slot: **2.0x**
- V52 V50 slot: **2.0x**
- V52 stock admission reserves a **20bps worst-case gross buffer**

This is intentionally distinct from the separate formal manifest/order-enable contract of 3.0 / 1.5 / 3.5.

## Effective runtime evidence resolved

### Q102

Read-only VPS verification established adopted exits ON, profit-floor ON, and exact ACK ef1ab178e26a7bf5bddb6473467765edba242e1d. The prior ON/OFF uncertainty is therefore resolved.

### FET

Read-only VPS verification established trailing enabled with policy FET_TRAIL_8P_GIVEBACK_4P. Current policy also includes hard stop 5%, +5% profit floor to +3%, +8% trailing arm / 4-point giveback, 24h cooldown, max gross 1.0x and residual minimum 0.05x.

### HYPE

Effective preemption is OFF and maximum gross is 1.5x.

### RESIDUAL

The old independent RESIDUAL rows with 79 missing exits are not a current seven-runner Production strategy. They are excluded rather than guessed or backfilled.

### V52

The formal manifest still names 4d33d824..., but the effective active source observed on VPS is 8495daf24e53a6cf0dd5e38f022008fa8f78c688.

Its live runner-start evidence reports crypto 3.0, stock 4.0, total 4.25, V11 2.0 and V50 2.0. The replay therefore keeps a 2.0x stock request and applies stock/total residual plus the 20bps worst-case buffer instead of hard-coding 1.5x.

V50 remains a historical price proxy rather than executable-book parity.

## V11 status

V11 exists in the effective V52 implementation and is not silently treated as nonexistent. Current live logic uses 10:00 NY signal selection and 10:30 review across AMZN/META/MSFT/NVDA/TSLA, with basis, cost, depth, spread, freshness, adverse-move and fill gates.

Effective VPS cost constants were verified at notional $200, maker 0bps, taker 6bps, safety buffer 5bps.

Five Aster stock-token 5-minute histories were recovered for the whole period, each with 105,120 bars and SHA256-frozen.

The historical reference/book side remains incomplete. The conservative price-envelope audit found:

- days checked: **250**
- price-possible candidate days: **87**
- price-robust candidate days: **0**
- overlapping live evidence window: 2026-09-07 through 2026-09-30
- live V11 decisions in that window: **25**
- live non-null V11 candidates: **0**
- live V11 positions opened: **0**

V11 is therefore fail-closed omitted in the full-year baseline. This matches the only overlapping live-evidence window, but it is not proof for unobserved months.

## Current-effective core baseline

Period: 2025-10-01 00:00 UTC to 2026-10-01 00:00 UTC, end-exclusive. Initial capital JPY 10,000.

| Cost | Final MTM | Max DD | Fills | Win rate | PF |
|---:|---:|---:|---:|---:|---:|
| 10bps | **¥2,274,782.96** | **-46.8861%** | 772 | 61.0104% | 1.2631 |
| 30bps | **¥743,399.95** | **-54.6892%** | 772 | 58.2902% | 1.2006 |

Independent rerun: **8/8 core artifacts SHA256 PASS**.

Classification: **EFFECTIVE-CURRENT CORE PARITY — V11 FAIL-CLOSED / NOT FULL VENUE EXECUTION PARITY**.

## Research-gate A/B on exactly the same baseline

Only candidate admission changes. Q102 exits, FET trailing, HYPE settings, gross caps, V52 dynamic gross, fees, funding, exits, shared wallet and V11 fail-closed treatment remain identical.

Research-only gates:

1. IDLE JUP: features.rel24 >= -0.04089204262472046
2. PENGU V8: btc24h <= 0.011611625094354983
3. Q102 FET: ret14 <= 0.048722800378429465

### 10bps

| Case | Final MTM | Δ final | Max DD | DD improvement | Fills | Win rate | PF |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | ¥2,274,782.96 | — | -46.8861% | — | 772 | 61.0104% | 1.2631 |
| IDLE JUP | ¥2,936,205.22 | +29.08% | -46.8861% | +0.000pt | 769 | 61.2484% | 1.3176 |
| PENGU V8 | ¥3,005,848.25 | +32.14% | -34.0790% | +12.807pt | 767 | 61.4081% | 1.3363 |
| Q102 FET | ¥2,321,189.26 | +2.04% | -47.8070% | -0.921pt | 770 | 61.2987% | 1.2926 |
| THREE | **¥4,050,805.95** | **+78.07%** | **-34.5468%** | **+12.339pt** | 761 | **62.0237%** | **1.4668** |

### 30bps

| Case | Final MTM | Δ final | Max DD | DD improvement | Fills | Win rate | PF |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | ¥743,399.95 | — | -54.6892% | — | 772 | 58.2902% | 1.2006 |
| IDLE JUP | ¥967,597.02 | +30.16% | -54.0732% | +0.616pt | 769 | 58.5176% | 1.2448 |
| PENGU V8 | ¥994,640.49 | +33.80% | -45.9846% | +8.705pt | 767 | 58.6701% | 1.2595 |
| Q102 FET | ¥785,433.64 | +5.65% | -52.6343% | +2.055pt | 770 | 58.5714% | 1.2279 |
| THREE | **¥1,365,296.98** | **+83.66%** | **-44.3713%** | **+10.318pt** | 761 | **59.3955%** | **1.3646** |

Candidate removals: IDLE JUP 213, PENGU V8 16, Q102 FET 25, all three 254.

Independent rerun of all four cases: **32/32 core artifacts SHA256 PASS**.

## Interpretation

The strongest single DD improvement is the PENGU V8 BTC24 gate:

- 10bps DD improvement: **12.807pt**
- 30bps DD improvement: **8.705pt**

IDLE JUP strongly raises final equity and PF, but has no 10bps DD effect.

Q102 FET is mixed: final equity, win rate and PF improve at both costs, but 10bps max DD worsens by **0.921pt**, while 30bps DD improves by **2.055pt**.

The three-gate bundle is strong as a combined result, but Q102 FET is not independently proven as a DD improvement and should undergo interaction/threshold analysis before any implementation decision.

## Superseded result

Do not use the earlier 847-fill, Stock 1.5x / Total 3.5x result as the current-effective baseline. It describes the separate formal activation contract more closely, not the effective runtime observed here.

The current comparison baseline is the 772-fill effective-runtime case above.

## V11 sensitivity robustness

Because full-year V11 microstructure parity is unavailable, a separate sensitivity layer injected the 34 cached V11 candidates that exist through the historical cache. This is explicitly **not** treated as current-parity truth; it is an uncertainty stress test.

Four V11 modes were compared against the same three research gates:

- NONE: no V11 candidates
- ALL: all 34 cached candidates
- WIN_ONLY: 27 cached candidates with positive cached gross return
- LOSS_ONLY: 7 cached candidates with non-positive cached gross return

| V11 mode | Cost | Baseline DD | THREE DD | DD improvement | Final improvement | Win improvement | PF improvement |
|---|---:|---:|---:|---:|---:|---:|---:|
| NONE | 10bps | -46.8861% | -34.5468% | +12.339pt | +78.07% | +1.013pt | +0.2037 |
| ALL | 10bps | -46.8860% | -34.5468% | +12.339pt | +78.01% | +0.990pt | +0.2092 |
| WIN_ONLY | 10bps | -46.8860% | -34.5468% | +12.339pt | +78.01% | +1.002pt | +0.2102 |
| LOSS_ONLY | 10bps | -46.8861% | -34.5468% | +12.339pt | +78.07% | +1.001pt | +0.2026 |
| NONE | 30bps | -54.6892% | -44.3713% | +10.318pt | +83.66% | +1.105pt | +0.1640 |
| ALL | 30bps | -54.6605% | -41.6094% | +13.051pt | +83.60% | +1.073pt | +0.1685 |
| WIN_ONLY | 30bps | -54.6605% | -41.6094% | +13.051pt | +83.60% | +1.085pt | +0.1703 |
| LOSS_ONLY | 30bps | -54.6892% | -44.3713% | +10.318pt | +83.66% | +1.093pt | +0.1620 |

The three-gate improvement survives every tested V11 sensitivity mode. At 10bps the DD improvement stays approximately +12.339pt; at 30bps it ranges from +10.318pt to +13.051pt. Final-equity uplift remains approximately +78% to +84%.

This sensitivity suite was independently rerun and **64/64 core artifacts matched SHA256**.

This does not make the cached V11 rows exact live-history reconstruction. It shows that the research-gate conclusion is not dependent on the fail-closed V11 omission.

## Remaining parity limits

1. full-year V11 reference/order-book/fill history is unavailable;
2. V50 is still a historical price proxy;
3. modeled historical fills are not signed venue fills;
4. V4 V2 historical candidate selection is retrospective, so implementation parity is not unbiased causal evidence.

These limits are shared by baseline and research A/B, so the A/B is a controlled relative comparison, not an exact realized-performance claim.

No LIVE order, cancel, position, STOP, Kill Switch, systemd activation or Production mutation was performed.
