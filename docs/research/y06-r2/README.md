# Y06-R2 — Independent dual-side trend/pullback research (NO LIVE)

**Status: RESEARCH ONLY — REJECTED FOR PRODUCTION ADOPTION as of 2026-11-26 JST.**

This folder contains a new independent LONG/SHORT strategy generator and a three-period
ASTER H1/M5 backtest. It does **not** modify or call any authorized production
runner, venue trading API, order permit, risk controller, or GLOBAL HOLD release.

## Frozen methodology

- **A (strict)**: fully completed UTC 24h/12h/6h returns on the asset all agree in
  one direction, plus BTC completed 12h agrees. **B (points-based)**: asset completed
  24h/12h agree, at least one completed 6h/4h agrees, and BTC 12h agrees.
- LONG follows an uptrend only after a completed H1 pullback toward EMA12 and a
  subsequent completed M15 close breaking the prior two M15 highs; SHORT is
  the symmetric downtrend/retest entry. Mixed or contrary => NO TRADE. Enter
  at the **next M5 open**. Setup expires at 8h.
- Structural invalidation from ATR14(H1) and recent 6h extreme, bounded between
  1.5% and protected maximum 8%. For two-sided candles, **stop takes precedence**.
  Take profit at 1.8 × risk. Independent 24h / 48h maximum holding variants.
- Entry Gross 0.30× account, at most two positions, no same-symbol overlap,
  12h cooldown after exit. Start ¥10,000. 10bps and 30bps roundtrip
  separately; every candidate uses exact archived OHLC5 bars and H1 closed
  boundaries; no future-bar entry features. Data accepted only with
  preceding48h M5 >=75% nonzero volume and H1/M5 OHLC within 0.1% over 6h.
  Bad OHLC bars are quarantined, not repaired or forward-filled.
- Stress: 0.5% of entry additional adverse fill on structural/STOP8 exits;
  M5 Mark-to-market cumulative max DD; standalone R2 account only.

## Executed research results (30bps, not comparable to 7-runner STABLE4 earnings)

| Variant | PRE terminal / DD | TARGET terminal / DD | FORWARD terminal / DD |
|---|---|---|---|
| A: D/12/6 full trend, exit24h | ¥8,785 / 15.04% | ¥5,946 / 45.30% | ¥9,369 / 12.23% |
| A: full trend, exit48h | ¥9,815 / 12.57% | ¥5,256 / 50.32% | ¥8,559 / 17.97% |
| B: D/12 and 6 or 4, exit24h | ¥9,060 / 15.58% | ¥5,964 / 43.92% | ¥9,565 / 10.46% |
| B: points, exit48h | ¥10,313 / 12.75% | ¥5,614 / 46.12% | ¥9,014 / 13.55% |

Period boundaries: PRE 2025-03-24–2025-10-01, TARGET 2025-10-01–2026-10-01,
FORWARD_INSPECTED 2026-10-01–2026-11-23 UTC (end exclusive).
These periods were previously inspected in the earlier Y06 research; **none**
is pristine untouched out-of-sample.

At TARGET, A/24h produced 678 admitted 30bps trades, 39.53% wins, PF0.806,
and -40.53% compounded equity loss. Structural-stop fills n310 versus 172
1.8R take-profit fills. In the extra adverse fill stress, DD rose from
45.30% to 64.74%.

Synthetic exercise: six market processes × four deterministic seeds, BTC+
13 altcoins, artificial OHLC5, identical A/B/24h/48h rules. A/48h
was profitable in 17 of 24 synthetic paths but performed inconsistently
across market regimes; synthetic profits do not validate real-market edge.
Simulation is stylized (uncalibrated market prices), not ASTER actual prices.

## On-owner-PC reproduction

The **exact executed sources** are mirrored from:

`C:\tmp\disdex-d126-crossrunner-research-20261126\y06_r2_bt_engine_v2.py`

`C:\tmp\disdex-d126-crossrunner-research-20261126\y06_r2_synthetic_24markets.py`

`C:\tmp\disdex-d126-crossrunner-research-20261126\test_y06_r2_causal_readonly.py`

They contain explicit owner-PC input/output roots and need the immutable
research market-data archives already present on that PC. Run with Python,
NumPy and archived ASTER OHLC files. For a different machine, adapt only
the ROOT/WORK source directories in an **independent research copy**
and regenerate SHA256 evidence. Never modify signed production source
to make this research code work. Running this code makes **zero orders**.

Evidence outputs, intentionally **not committed** because they include a
large raw candidate/fill ledger and all price-data references, live at:

- `C:\tmp\disdex-d126-crossrunner-research-20261126\Y06_R2_NEW_LOGIC_ARCHIVED_M5_BACKTEST_20261126.json`
  SHA256 `dd27b801dcf7a71d7b8f92cb018ce83e6987c9ad4ed30f6bf64d3656ede4f326`
- `C:\tmp\disdex-d126-crossrunner-research-20261126\Y06_R2_24_SYNTHETIC_MARKETS_20261126.json`
  SHA256 `58e30681e7121b7e32b5843612e848a892d52429a31f17cb38fcf77959b2eb29`
- Source bar quality and invalid record quarantine manifest, plus summaries,
  are referenced in `Y06_R2_BT_RESULTS_SUMMARY_20261126.json`.

## Verification and next acceptance gates

Causal unit tests passed on owner PC: source candidates based on previously
completed candles only; changing future candles did not alter earlier
signals; M5 simultaneous stop and target always resolves to STOP; structurally
invalid ASTER bar quarantined. New R2 source remains independent of the
immutable production V4, Q102, and HYPE components.

**DO NOT ADOPT** based on these numbers. Requires an actually untouched
future period, positive 30bps expectancy across regimes, win/DD and
loss-tail confidence, favorable same-time random controls, funding and
venue reconciliation, and full STABLE4 seven-runner native Gross/SharedRisk
risk-engine BT before owner-signed formal release authorization. Do not
remove STOP8, bypass GLOBAL HOLD or issue test orders.
