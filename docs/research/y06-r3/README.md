# Y06-R3 — Failed-retest bearish SHORT (research only)

**Decision, 2026-11-26: not approved for Production or LIVE orders.**

This is an independent SHORT strategy derived from the earlier **¥12,092 synthetic-market** result for a bearish D126 breakdown. It does **not** invert an existing LONG signal into a SHORT. It operates in an isolated research worktree and never calls an exchange order API.

## Strategy

The benchmark shorts directly on a newly completed H1 close below the preceding 12 H1-bar low by 0.1×ATR14, while the asset has confirmed UTC D/12H/6H bearish returns and 6H relative performance below BTC.

The new R3 design instead waits for that downside break, a *later* H1 candle retesting the old low (high at least floor−0.25×ATR), and a *strictly subsequent* bearish H1 candle closing back below the breached level and the previous H1 close. The optional M15 variant requires a further completed bearish 15-minute close below the prior two completed M15 lows. Entries are on the next M5 open, never on an unseen current candle. Arming expires in 12h.

The original, predeclared design tested all three entries against **hard protected STOP8 + 24h TIME**, a 1.5–8% structural stop + 2R target +24h TIME (STOP always wins same M5 double hit), and STOP8 +48h TIME. Gross 0.30× per position, max two open positions, same-symbol exclusive, cooldown12h; 10bps/30bps independently, capital ¥10,000; M5 mark-to-market maximal portfolio DD.

## Key real ASTER H1/M5 results — 30bps, standalone account

| Model | PRE terminal / DD | TARGET terminal / DD | inspected FORWARD terminal / DD |
|---|---|---|---|
| Immediate low-break SHORT, STOP8/24h | ¥8,325 /20.48% | ¥10,673 /25.45% | ¥9,667 /13.85% |
| **R3 H1 retest SHORT, STOP8/24h** | **¥9,208 /9.63%** | **¥10,181 /13.39%** | **¥10,967 /7.90%** |
| R3 M15 retest SHORT, STOP8/24h | ¥8,967 /12.06% | ¥8,705 /23.27% | ¥10,916 /4.51% |

Periods: PRE 2025-03-24–2025-10-01; TARGET 2025-10-01–2026-10-01; FORWARD_INSPECTED 2026-10-01–2026-11-23 UTC (end excluded). ALL three historical periods have been inspected in previous research; **none is pristine untouched OOS**.

The strongest DD improvement is R3 H1 retest, but PRE is still negative. TARGET had **145 trades / 45.5% win / PF1.036**, leaving a narrow margin vulnerable to omitted Funding and exchange slippage. FORWARD only **25 admitted trades**. Target same-symbol shifted-entry control (±1/3/6/9/12h, 4,000 draws) averaged **+0.84% per trade**, versus R3 H1 retest **+0.06%**. The entry does not demonstrate predictive timing.

## Artificial-market falsification

Using the **same 24 fixed BTC+13alt synthetic price paths** (six regimes × four seeds) as earlier Y06-R2 research:

- Immediate low-break STOP8/24h averaged **¥9,414** terminal, DD43.07%, profitable10/24.
- R3 H1 retest STOP8/24h averaged **¥10,770**, DD34.62%, profitable15/24.
- R3 M15 retest STOP8/24h averaged **¥12,025**, DD31.00%, profitable15/24, but FAILED target real-market profitability (¥8,705). Synthetic high performance alone is explicitly NOT sufficient.
- Synthetic stable-bull R3 H1 retest averaged ¥6,108; synthetic bullish-squeeze ¥6,127, both 0/4 profitable.

An exploratory, **posthoc** BTC latest completed 12h negative guard was additionally investigated after seeing those results. It improved R3 H1 retest TARGET equity **¥10,181→¥10,585** and DD **13.39→9.90%**, and synthetic average **¥10,770→¥11,799** with DD **34.62→26.92%**. Nevertheless PRE remained **¥9,256 (negative)**; synthetic bullish-stable and squeeze remained negative, and BTC12 + R3 **failed regime-matched random entry alpha**: TARGET actual +0.174% per-trade vs random +0.354%, PRE actual −0.582% vs random −0.205%. **Do not adopt** this guard without an independent new period. This guard was not part of the original frozen R3 protocol and is marked posthoc.

## Integrity, files, and reproduction

Nine R3 combinations were preregistered in `Y06_R3_FROZEN_BREAK_RETEST_PROTOCOL_20261126.json` before their results. BTC posthoc alternatives have a separate frozen protocol and explicit hindsight warning. Both protocols and a detailed JSON evidence summary are in this folder.

The original real BT was rerun after moving only its import guard (v1→v2) and showed **exact equality of every research signal, fill, 3-period / 10bps / 30bps account result**. Unit tests PASS for: changing future H1/M5 prices does not change earlier entry signals; fully completed 15-minute/H1 boundaries; stop-first behavior in ambiguous M5; STOP8 never disabled. Test and source SHA256 are in the evidence summary.

Research files are stored on the authorized owner PC under `C:\tmp\disdex-d126-crossrunner-research-20261126`. The scripts intentionally point to that owner-PC immutable ASTER archive and the previous `y06_r2_bt_engine_v2.py` research helper. To execute on a different authorized host, copy the research assets and adjust absolute **data paths only**, not the trading/runtime code. Full raw trade/price/event ledgers are intentionally NOT committed to this PR; the summary provides their exact filesystem paths and SHA256 hashes.

**Formal acceptance remains blocked.** Requires truly untouched longer forward period, funding/fee/slippage/gap and signed executable-exit parity, favorable same-symbol random controls, gross/correlation risk against every other STABLE4 runner, cumulative account DD, and explicit owner certification. **Do not merge as an order-enabled release, bypass GLOBAL HOLD, or send test orders.**
