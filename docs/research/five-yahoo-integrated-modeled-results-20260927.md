# 2026-09-27 Yahoo Finance V52 + 4-crypto chronological research replay

**Scope:** New one-year *counterfactual research model*, not the historically verified five-logic LIVE-parity BT. The production release was `a09ea45ca3cbd72100f9eb0eaae499039c40b6a0`; production code, orders, controls and VPS runners were not changed. Initial capital ¥10,000, 12 additional monthly ¥10,000 deposits, ¥130,000 total, 2025-08-10 through 2026-08-10 UTC.

## User-authorized V52 assumptions

Yahoo Finance original unadjusted **60-minute** stock prices for AMZN, META, MSFT, NVDA and TSLA are the *hypothetical executable entry/exit price at a qualifying gate*, without requiring historical L2, quote depth, spread history, partial fills or market queue. V11_EQ and V50_POST_OPEN_BASIS retain their documented 10:30, 11:30, 12:30, 13:30 New York windows, a 10:00 reference capture for V11 and approximate 10-second lookback for V50. To compute the **actual basis trigger formula**, the replay uses publicly acquired, timestamped Aster **stock-perpetual H1 opening prices** against the Yahoo stock reference. Yahoo-only equity candles cannot establish a perp-versus-equity basis. Even with Aster H1 used for signals, this is not the actual Aster execution price and the account's authentic historical fill is not observed.

The source manifests for 1,791 Yahoo 60-minute bars **per ticker** and 8,784 native Aster H1 bars per stock ticker passed SHA256 provenance, with both originals preserved privately on VPS.

## Stand-alone V52 assumed-fill diagnostics

Read-only GitHub run: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36290168562

| Research scenario | Modeled V52 closed trades | V11_EQ | V50_POST_OPEN_BASIS | Win rate | Unweighted per-trade PF |
|---|---:|---:|---:|---:|---:|
| NORMAL, assumed 20bps stock round trip | 163 | 58 | 105 | 35.58282% | 0.68307 |
| SEVERE, assumed 55bps stock round trip | 113 | 41 | 72 | 15.04425% | 0.18667 |

No shared V12/PENGU/Q102/FET capital and no real Aster fills are represented by this **stand-alone** table.

## Five-sleeve chronological *modeled* integration

Reuses the **same exact SHA-pinned** Aster 32-instrument data and independent 1,459 V12 + 52 PENGU + 101 Q102 + 26 FET selected signal observations, along with the Yahoo/stock-perpetual source originals. Crypto positions and Yahoo-assumed stock positions now share a single time-ordered capital account, same-stock/stock-slot/crypto-slot rejection, stock daily-loss/crypto daily-loss research gates, 3.0x normal crypto gross, 4.0x stock gross, 4.25x normal combined gross, and existing monthly deposits. Unlike the stand-alone V52 replay, stock signal candidates are collected *before* standalone portfolio occupancy so rejected stock slots can be reconsidered under the integrated account.

The **gross peaks** below are **dynamic mark-to-market** exposure, not requested gross at a new entry; the historical model does not reproduce live continuous stock gross/allocator preemptions. It enforces ordinary entry caps but can drift beyond them with changing marked equity. Observed crypto peaks remained below the 5.0x crypto hard ceiling and total below 8.0x hard ceiling.

| Integrated diagnostic (NOT LIVE parity) | NORMAL | SEVERE |
|---|---:|---:|
| Modeled final asset, JPY | ¥81,908.92 | ¥23,307.79 |
| Modeled net after ¥130,000 contributions | -¥48,091.08 | -¥106,692.21 |
| Model closed trades, all five | 704 | 636 |
| Yahoo-V52 modeled entry fills | 160 | 112 |
| Crypto modeled entry fills | 544 | 524 |
| Model win rate | 42.47159% | 36.32075% |
| Model profit factor | 0.93084 | 0.63200 |
| Model cash-flow-adjusted H1/30m sampled maximum DD | -73.90449% | -99.70270% |

These figures **must not** be compared to the older ¥740m+ integrated canonical BT or used to select production gates or leverage: the approximation can invert strategy returns. Especially, V12 uses H1-ATR instead of live H2 ATR, Q102 substitutes time exits for causal family protection, V52 hypothetical Yahoo share price returns are not the real Aster stock-perp P&L, and shared-Gross preemption and actual execution fees/margin liquidation are not fully reconstructed. They are engineering diagnostics of the requested Yahoo-price assumed-fill scenario, not a claim of actual achievable profit/loss.

## Modeled monthly net asset value (JPY), cash contributions shown separately

These monthly estimates come from the five-sleeve research model above, **not from actual trading records or the historic canonical backtest**. The last row is August 10, not August 31.

| As-of month | Cumulative contribution | NORMAL model NAV | SEVERE model NAV |
|---|---:|---:|---:|
| 2025-08 | ¥10,000 | ¥6,266.25 | ¥4,285.86 |
| 2025-09 | ¥20,000 | ¥13,241.25 | ¥9,232.12 |
| 2025-10 | ¥30,000 | ¥30,951.02 | ¥18,467.57 |
| 2025-11 | ¥40,000 | ¥37,819.68 | ¥18,225.96 |
| 2025-12 | ¥50,000 | ¥31,857.05 | ¥13,916.38 |
| 2026-01 | ¥60,000 | ¥63,096.16 | ¥25,842.53 |
| 2026-02 | ¥70,000 | ¥41,500.57 | ¥14,625.31 |
| 2026-03 | ¥80,000 | ¥87,068.40 | ¥26,440.50 |
| 2026-04 | ¥90,000 | ¥58,064.61 | ¥18,684.10 |
| 2026-05 | ¥100,000 | ¥120,731.56 | ¥38,855.06 |
| 2026-06 | ¥110,000 | ¥177,265.59 | ¥40,457.88 |
| 2026-07 | ¥120,000 | ¥83,255.51 | ¥15,873.25 |
| 2026-08 (Aug 10) | ¥130,000 | ¥81,908.92 | ¥23,307.79 |

**Independent full replay passed exact ledger SHA256 parity:** NORMAL `484e0bb6fd784dad9d48ba208d3c3e133dc9211a759a642d11d48f84dc24c265`; SEVERE `6a3e12f86f849282df50c63998812f215456e854a6cee49a5ab73626c0ed3099`. Source and monthly reconstruction: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36290897686

The individual modeled trades and month-by-month CSVs were preserved as the **root-owned, SHA256-verified** VPS archive `/var/lib/disdex/research-bt-formal/a09-five-yahoo-integrated-36290897686.tgz`, SHA256 `2f97f6c0fdde9d3af6c99a889a6541e3556ffd08665e965e24440ac432ee3a43`. Raw Yahoo/Aster provider data stay separately archived and are not published.

**Status:** the user's V52 Yahoo/no-L2 *research assumption* was implemented and modeled; the five-logic verified LIVE-parity BT remains `NOT_VERIFIABLE` until the crypto execution/exit/allocator parity and historically verifiable shared trade ledger are established. HYPE/ZEC are outside this pinned a09 five-logic cohort.
