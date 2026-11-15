# RENDER independent SHORT: Gross .75x / leverage 5x / TP+2.5% / 6h / absolute new-signal priority
Date: 2026-10-26

**Research only; NOT LIVE; not real Aster venue or newest Production execution certification.**

## Requested case

- No 6h historical Shadow sample/WR/PF gate. Keep historical Shadow diagnostic, causal market Gate, and no-OI independence.
- RENDER OI-free market Gate: BTC completed H1 >= +0.15%; RENDER H1 <= -0.50%; last completed H4 <= -0.15%; RENDER H1 taker sell >=53%; H1 upper wick/open >=0.35%.
- Gross 0.75x NOTIONAL relative to account equity. Venue 5x means *initial margin* about account equity 0.15x, not multiplying gross by 5; additional maintenance and safety margin required.
- Short TP+2.5%, resident stop -2%, maximum hold 360 min; nominal gross 0.75x; 12h independent cooldown; do not liquidate already-held positions to enter; resident protection/owner/shared account lock remain mandatory.
- Under 0.75x gross, TP+2.5% is at most +1.875% account-equity before costs; STOP-2% is -1.5% before costs. At 30bps, nominal cost drag adds another -0.225% of equity for a filled .75x notional.
- Priority experiment removes other **same-timestamp new-entry** candidate rows when the RENDER causal Gate passes. It NEVER overrides standing positions, hard shared gross, account/margin safeguards, existing stops, or kill switches.
- The 5x venue margin and order life cycle are NOT reproduced or signed by the H1 model; observed accepted model gross can be less than requested because of capacity limits.

## Standalone historical trade quality (price-model only)

From official Binance public 5m monthly archives; economic period 2025-08-10 to 2026-08-10. 11 raw independent market candidates (without the 24-shadow historical quality Gate), with modeled TP+2.5% / SL-2% / max6h and independent 12h entry cooldown.
- 10bps: 11 trades, 10 wins, 1 loss; WR 90.91%; PF 9.2538; mean net +1.5757% **per unit notional model**, NOT per account equity.
- 30bps: 11 trades, 10 wins, 1 loss; WR 90.91%; PF 7.5796; mean net +1.3757%.
- Historical trade simulation can overfit; stop-first ambiguous M5 and public Binance data not authentic signed Aster fills.

## Native8 shared-wallet comparable reruns

Eight sleeves: V12, Q102, PENGU, IDLE, RESIDUAL, V52, HYPE_LONG, FET. All replay rows retain the legacy RENDER -1% / 2h / MFE <+.25% close monitor.

| Option | Final equity 10bps JPY | Final equity 30bps JPY | Independent accepted |
|---|---:|---:|---:|
| Existing legacy RENDER stop only | 279,087,048 | 169,095,336 | 0 |
| Independent Gross .25x, default owner | 278,549,500 | 167,477,399 | 3 |
| Independent Gross .75x, default owner | **281,254,554** | **169,494,414** | 3 |
| Independent Gross .75x, **absolute priority among NEW signals** | 281,150,307 | 167,935,780 | **4** |

All scenarios maximum portfolio MTM DD unchanged approx -14.515% at 10bps and -15.015% at 30bps; three replicated portfolio runs per cost with accounting PASS. For default owner .75x on 10bps, accepted gross was .7500/.7500/**.6300**, not three full .75x orders; at 30bps .75/.75/.75. Priority-model .75x 10bps accepted .75/.75/.6846/.6304; 30bps .75 in each of four.

Raising gross from .25 to .75 using same model and default owner increased equity by:
- 10bps JPY +2,705,054
- 30bps JPY +2,017,015

**Absolute new-signal priority vs default owner at Gross .75 had NEGATIVE effect:**
- 10bps JPY -104,247
- 30bps JPY -1,558,634
This occurred even as RENDER independent accepted trades rose from 3 to 4. The change displaced original V12 BTC and XRP and Q102 FET new entries, and changed subsequent idle ownership; it is NOT proof that strict unconditional RENDER priority improves the total wallet.

The raw eleven RENDER market-Gate timestamps included **9** timestamps at which the base-model wallet already held other strategy positions. Highest priority among new entries cannot magically free that collateral, and the current model does not force-close protected positions. With some standing positions, the native portfolio capacity and per-strategy ownership can block additional entries even if RENDER shows better standalone history.

## Recommendation

The .75x gross improvement warrants additional work as a *candidate* with shared exposure gates. Do **not** adopt unconditional highest priority: keep candidate score-aware competition and preemption conditional on exact causal expected value/PF, existing owner's measured expected value, and available account margin. Absolute priority produced larger 30bps equity deterioration. Test a middle option (.50x) and a capped .75x when the portfolio is relatively flat or when an incumbent is clearly inferior, with untouched-forward evidence. Keep both RENDER changes disabled for new LIVE until real Aster venue proof, production-SHA-bound certification, rollover/restart recovery and authorized operator final cutover.

## Reproducible research

- scripts/research/render-priority-gross075-model-bt-20261026.py
- scripts/research/render-top-priority-gross075-model-bt-20261026.py
- docs/research/results/render-dual-20261026/RENDER_GROSS075_TP25_H6_PRIORITY_NATIVE8_COMPARISON_20261026.json
- Primary historical M5 archive and H1 archived native wallet remains locally under C:/tmp/render-dual-preflight-native8-20261025 and C:/tmp/render-multiregime-study-20261024 on the authorized Windows PC.

**No VPS service, production symlink, actual venue account, orders or open positions were changed.**
