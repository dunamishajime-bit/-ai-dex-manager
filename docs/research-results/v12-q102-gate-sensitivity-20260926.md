# V12 / Q102 Gate sensitivity and live access hotfix — 2026-09-26
Status: **RESEARCH ONLY for all gate variants**; **ROOT HELPER HOTFIX APPLIED** for shared kill-switch ownership. Exact trading runtime e1b58060d6263a3af7ced51bec854d3e211d2f35 remains unchanged.

## Source and deployment proof
- Correct production root entrypoint: `/usr/local/libexec/disdex-v12-kill-switch-auto-repair`, invoked by `disdex-v12-kill-switch-auto-repair.service`; do not confuse with nonexistent `/usr/local/sbin/...`.
- Root helper ownership fix in this branch corrects the preexisting root:root/0700 shared-parent plus root:root/0600 latch EACCES bug. It preserves a healthy deploy:deploy setgid directory's group contract, rejects symlink targets, uses atomic same-dir replacement, and checks deploy readback. The fail-closed latch contents and activation/operator gates are unchanged.
- Isolated hosted-root + actual VPS fixture regression **PASS**; remote exact-source SHA gate, idle service gate, no active recovery lock, atomic helper-only deploy; original saved under root-owned `/home/deploy/disdex-ops/patch-backups/`; no trading runtime restart or orders. https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36232305191
- Protected VPS retention timer active, installed script matches current release, but official `--dry-run` found **zero safe deletions** because old systemd/current-runtime references pin old releases. Disk ~96.65% used; do not delete historical BT or referenced releases without separately proven archival/rollback protection. https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36231934531

## Production-parity V12 short-sample gate research
Research script: `scripts/research-v12-gate-sensitivity-20260926.ts`. GitHub Actions PASS, original frozen signal selection parity EXACT across 170 H2 decision windows, all 14 frozen symbols, public Aster H1 2026-09-05T16Z–2026-09-26T08Z. HC 1.75 unchanged. This is a **20.7-day overlapping 24h signed forward-return proxy after 0.3% assumed round-trip costs**, NOT realized PnL, exits, integrated risk, compounded yield, or an official 365d BT. https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36232524592

| Volume floor | Score floor | Potential selected entries | HC opportunities | Net 24h forward mean | 24h positive share |
|---:|---:|---:|---:|---:|---:|
| 0.9845 | 1.4649 | 114 | 14 | +1.459% | 57.02% |
| 0.8000 | 1.4649 | 123 | 16 | +1.751% | 56.10% |
| 0.6000 | 1.4649 | 129 | 16 | +0.893% | 50.39% |
| 0.4000 | 1.4649 | 141 | 19 | +0.895% | 52.48% |
| 0.9845 | 1.2500 | 117 | 14 | +1.490% | 55.56% |
| 0.9845 | 1.0000 | 125 | 14 | +1.465% | 56.80% |
| 0.8000 | 1.0000 | 133 | 16 | +1.541% | 55.64% |
| 0.6000 | 0.8000 | 156 | 14 | +0.953% | 51.92% |
| 0.4000 | 0.8000 | 171 | 15 | +0.634% | 51.46% |
| 0.4000 | 0.6000 | 193 | 16 | +0.557% | 49.74% |
| 0.2000 | 0.6000 | 211 | 19 | +0.385% | 49.76% |

More signals replace some frozen selections; added count is not equal to total delta. Overlapping observation windows do not establish independent statistical significance. At live 17:00 JST snapshot, neutral score max 0.635 vs required 1.4649, so volume-only changes do not solve the *specific* neutral bar.

## Production Q102 causal observer and threshold-only counterfactual
Latest read-only Q102 ranking observer 2026-09-26 ~18:05 JST, 22 tracked symbols, 0 natural signals. Exact current diagnostics: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36232674382
- SUI: ret14d +60.07%, ret24h +12.92%, RSI61.59, bar UP, longDrop8% and RSI<=35. No long pullback; short trend regime not aligned.
- ONDO: ret14d +55.54%, ret24h -2.57%, RSI56.91, bar DOWN, longDrop8% and RSI<=35; short trend direction not aligned.
- TAO: ret14d +32.54%, ret24h +3.26%, RSI58.30, bar DOWN, shortRally8% and RSI>=65; short trend regime invalid.
- Threshold-only HIGH_VOL scaling 1.00/0.95/0.90/0.85/0.80 produced **zero newly fully qualified candidates** on this observed bar; it is a one-bar gate sensitivity, not BT.
- FET S34 BRK24: 0.2426 vs prior high0.2482, volume ratio6.75 vs1.20; price breakout not reached. RENDER BRK168 close1.994 above prior high1.982 but volume0.8883 vs1.2; also 14d return+43.76% exceeds frozen BRK variant V4 feature window [15%,30%), so volume-only relaxation is insufficient.
- Historical REV LONG ret14>=+24% additive loss gate trained on pre-2026-01-15 data: all six removed holdout trades were losses; holdout PF2.94->3.62, DD-5.53%->-3.66% (research-only frozen Sept6 evidence `audit/quality102-causal-v4-rev-long-loss-gate-20260906.md`). Do **not** relax this gate without new independent holdout evidence.
- Q102 raw walk-forward HIGH_VOL monthly rule selection requires >=181 days H1 per symbol; 20d public Aster sensitivity is **not** equivalent to re-running this causal selector; full 365d data and 5-logic concurrency are mandatory to validate new Q102 rules.

## Required before any gate LIVE activation
1. Reproduce the **actual currently deployed** integrated 2025-08-10–2026-08-10 baseline with source SHA, frozen original data, PENGU COMBINED_FILTERED every entry Gross1.0, V12 Top3/HC1.75/dynamic2.0, FET2.25, Q102 causal V4 DD governor, V52 Yahoo/stock sleeve, 5x Cross, normal Crypto3.0/Total4.25 and profit/DD/margin governor. Preserve original raw data, scripts, and entry/exit logs. Formal anchor `docs/implementation/FINAL_INTEGRATED_GROSS_LIVE_CONTRACT_20260922.md`: NORMAL ¥1,448,665,533.02, PF4.1411, DD-19.6118%; SEVERE ¥75,982,803.52, PF3.01498, DD-19.97886%; not a guarantee of realizable future profit. Verify baseline first, then candidate deltas.
2. In isolated research runs compare frozen, volume0.8 only, neutral-score1.0 only, and 0.8+1.0 while HC1.75 fixed; for Q102 test separate, predeclared trend-following supplement rather than loosening loss-tested REV or invalidating the monthly HIGH_VOL selector.
3. Require closed-bar causality/no lookahead, actual order sizing and same-slot displacement, gross reservation, funding/slippage NORMAL and SEVERE, original and newly admitted trades by win/loss and exclusion cost, both 365d plus disjoint holdout, and **SEVERE max DD strictly <20%**. If any input or original baseline parity fails: **FAIL_CLOSED; no LIVE strategy configuration change**.
4. Existing live runner and margin gates, protection/readback, Kill Switch, deployment SHA, activation artifact and 5x Cross must never be loosened as a substitute for signal research.
