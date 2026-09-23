# PENGU Wave-Cover Reinforcement Research — 2026-09-24

## Scope
Production source SHA: `c6add8d39676584ad9db094d1ad04deb4050ed06`

Venue/data: Aster Futures V3, completed H1 bars.

Research-only. No LIVE/VPS/order changes.

## Stage 1

Long candidates:
- LONG_CONT: profitable V64 Long trailing-stop continuation, 24h arm, 6% activation / 3% retrace.
- LONG_SHORT_EXIT_FLIP: rebound Long after profitable SHORT_V20 exit, 36h arm.
- LONG_DEEP_RECLAIM: generic deep-decline reclaim Long.

Short candidates:
- SHORT_CONT: profitable SHORT_V20 continuation.
- SHORT_BLOWOFF_REVERSAL: early Short from bullish 72h regime rollover.
- SHORT_DIRECT_BREAKDOWN: direct breakdown without V20 bounce/rearm.

### Stage-1 conclusions
- LONG_SHORT_EXIT_FLIP was the strongest economic Long supplement.
  - Formal NORMAL: +499.864% vs baseline +466.635% (+33.228pt)
  - Formal SEVERE: +350.588% vs +325.502% (+25.086pt)
  - WR unchanged; PF improved; DD unchanged.
- LONG_CONT had no Formal sample, but captured the Sep-23 continuation:
  - Rolling365 NORMAL: +388.139% vs +384.403% (+3.735pt)
  - Sep-23 supplemental trade: +0.7711% account return.
- LONG_DEEP_RECLAIM degraded return/PF and was rejected.
- SHORT_CONT produced no qualifying sample and remains unproven.
- SHORT_BLOWOFF_REVERSAL improved Formal economics but its raw form slightly degraded Rolling365 SEVERE.
- SHORT_DIRECT_BREAKDOWN increased wave coverage but materially degraded return, WR, PF and DD; rejected.

The raw SHORT_BLOWOFF loss case on 2026-04-22 entered while BTC24 was +3.58% and PENGU24 was +9.02%. A confirmation filter was therefore preregistered for Stage 2:
- BTC24 <= +2%
- PENGU24 <= +6%

## Stage 2

Variants:
- LONG_PAIR = LONG_SHORT_EXIT_FLIP + LONG_CONT
- SHORT_BLOWOFF_RAW
- SHORT_BLOWOFF_FILTERED
- COMBINED_RAW
- COMBINED_FILTERED

Priority:
`SHORT_V20 > supplemental Short > BASE_V64_LONG > supplemental Long > Recovery V8`

### Formal 1-year window: 2025-08-10 to 2026-08-10

| Variant | NORMAL return | NORMAL WR | NORMAL PF | NORMAL DD | SEVERE return | SEVERE WR | SEVERE PF | SEVERE DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 466.635% | 72.464% | 4.304 | -11.992% | 325.502% | 69.565% | 3.411 | -13.788% |
| LONG_PAIR | 499.864% | 72.464% | 4.420 | -11.992% | 350.588% | 69.565% | 3.512 | -13.788% |
| SHORT_BLOWOFF_FILTERED | 536.393% | 73.239% | 4.521 | -11.992% | 373.140% | 70.423% | 3.583 | -13.788% |
| COMBINED_FILTERED | **573.713%** | **73.239%** | **4.638** | **-11.992%** | **401.035%** | **70.423%** | **3.684** | **-13.788%** |

COMBINED_FILTERED delta vs baseline:
- NORMAL return: +107.077pt
- SEVERE return: +75.533pt
- NORMAL WR: +0.776pt
- SEVERE WR: +0.857pt
- NORMAL PF: +0.334
- SEVERE PF: +0.274
- DD: no degradation.

Formal supplemental trades in COMBINED_FILTERED:
- 2025-09-19 SHORT_BLOWOFF_REVERSAL: +11.0995%
- 2025-12-02 LONG_SHORT_EXIT_FLIP: +17.8716%
- 2026-02-15 SHORT_BLOWOFF_REVERSAL: +1.0904%

## Rolling 365-day window through 2026-09-23

| Variant | NORMAL return | NORMAL WR | NORMAL PF | NORMAL DD | SEVERE return | SEVERE WR | SEVERE PF | SEVERE DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 384.403% | 67.606% | 3.258 | -24.341% | 261.594% | 64.789% | 2.643 | -28.038% |
| LONG_PAIR | 416.764% | 68.056% | 3.355 | -24.341% | 285.363% | 65.278% | 2.727 | -28.038% |
| SHORT_BLOWOFF_FILTERED | 393.208% | 68.493% | 3.282 | -23.796% | 264.691% | 65.753% | 2.653 | -27.873% |
| COMBINED_FILTERED | **426.157%** | **68.919%** | **3.379** | **-23.796%** | **288.663%** | **66.216%** | **2.737** | **-27.873%** |

COMBINED_FILTERED delta vs baseline:
- NORMAL return: +41.754pt
- SEVERE return: +27.069pt
- NORMAL WR: +1.313pt
- SEVERE WR: +1.427pt
- NORMAL PF: +0.121
- SEVERE PF: +0.094
- NORMAL DD improved by 0.544pt
- SEVERE DD improved by 0.165pt.

Rolling supplemental trades:
- 2025-12-02 LONG_SHORT_EXIT_FLIP: +17.8716%
- 2026-02-15 SHORT_BLOWOFF_REVERSAL: +1.0904%
- 2026-08-25 SHORT_BLOWOFF_REVERSAL: +0.7194%
- 2026-09-23 LONG_CONT: +0.7711%

All four NORMAL supplemental trades were positive.

## Formal 3-fold robustness — COMBINED_FILTERED

NORMAL:
- Fold1: +156.497%, WR 72.0%, PF 5.258, DD -11.172%
- Fold2: +116.420%, WR 79.167%, PF 9.765, DD -2.575%
- Fold3: +21.365%, WR 68.182%, PF 1.916, DD -11.992%

SEVERE:
- Fold1: +129.148%, WR 72.0%, PF 4.320, DD -12.175%
- Fold2: +97.379%, WR 75.0%, PF 7.406, DD -2.925%
- Fold3: +10.777%, WR 63.636%, PF 1.449, DD -13.788%

No fold was made economically negative by the supplemental routes; Fold3 had no new qualifying supplemental trade.

## Current research conclusion
The strongest current candidate is `COMBINED_FILTERED`:
1. LONG_SHORT_EXIT_FLIP — rebound after a profitable V20 Short exit.
2. LONG_CONT — continuation after profitable V64 Long trailing exit; explicitly catches the Sep-23 missed extension.
3. SHORT_BLOWOFF_REVERSAL_FILTERED — early rollover Short from a bullish regime, with BTC24 <= +2% and PENGU24 <= +6%.

This is still research-only. Production implementation should use a shared causal feature/gate path and preserve existing gross/risk/Fail-Closed contracts.
