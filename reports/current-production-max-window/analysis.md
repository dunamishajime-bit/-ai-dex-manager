# Current Production Max Window Analysis

## Backtest Setup

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solminus8_v6
- tradable_symbols: ETH, SOL, AVAX, PENGU, DOGE, INJ
- strict_extra_symbols: PENGU, DOGE

## Summary

- mode: RETQ22
- end_equity: 981154.22
- CAGR: 324.68%
- MaxDD: -38.41%
- WinRate: 53.68%
- PF: 2.11
- Trades: 95

## USDT Idle Analysis

- total_bars: 2317
- inferred_bar_hours: 12
- idle_bars: 1398
- idle_pct: 60.34%
- idle_days: 699
- exposure_days: 459.5
- idle_window_count: 42

### Longest Idle Windows

| start | end | bars | days |
| --- | --- | ---: | ---: |
| 2025-10-10T00:00:00.000Z | 2026-01-04T00:00:00.000Z | 173 | 86.5 |
| 2026-01-20T12:00:00.000Z | 2026-03-16T12:00:00.000Z | 111 | 55.5 |
| 2023-08-10T00:00:00.000Z | 2023-09-26T12:00:00.000Z | 96 | 48 |
| 2025-02-21T12:00:00.000Z | 2025-04-09T12:00:00.000Z | 95 | 47.5 |
| 2024-08-02T12:00:00.000Z | 2024-09-18T00:00:00.000Z | 94 | 47 |
| 2024-04-08T12:00:00.000Z | 2024-05-20T00:00:00.000Z | 84 | 42 |
| 2024-06-09T00:00:00.000Z | 2024-07-19T12:00:00.000Z | 82 | 41 |
| 2023-04-26T12:00:00.000Z | 2023-05-28T12:00:00.000Z | 65 | 32.5 |
| 2024-01-13T00:00:00.000Z | 2024-02-11T00:00:00.000Z | 59 | 29.5 |
| 2025-08-18T12:00:00.000Z | 2025-09-16T00:00:00.000Z | 58 | 29 |

## Losing Trades

- loss_count: 44
- win_count: 51
- loss_ratio: 46.32%
- total_loss_pnl: -876067.98

### Losses by Exit Reason

| exit_reason | count | total net pnl | avg net pnl | worst net pnl |
| --- | ---: | ---: | ---: | ---: |
| sma-break | 15 | -284337.18 | -18955.81 | -126275.94 |
| trend-switch | 13 | -218729.07 | -16825.31 | -66857.01 |
| strict-extra-rotate | 8 | -52768.41 | -6596.05 | -23522.51 |
| risk-off | 5 | -311716.85 | -62343.37 | -131415.07 |
| end-of-test | 1 | -7660.28 | -7660.28 | -7660.28 |
| off22-strong | 1 | -713.69 | -713.69 | -713.69 |
| range-time | 1 | -142.5 | -142.5 | -142.5 |

### Losses by Symbol

| symbol | count | total net pnl | avg net pnl | worst net pnl |
| --- | ---: | ---: | ---: | ---: |
| ETH | 18 | -335348.13 | -18630.45 | -131415.07 |
| SOL | 11 | -155543.31 | -14140.3 | -79300.62 |
| DOGE | 7 | -96631.22 | -13804.46 | -37949.6 |
| PENGU | 4 | -219786.51 | -54946.63 | -126275.94 |
| INJ | 3 | -1901.79 | -633.93 | -1256.31 |
| AVAX | 1 | -66857.01 | -66857.01 | -66857.01 |

### Worst 10 Losing Trades

| symbol | entry | exit | net pnl | bars | entry reason | exit reason |
| --- | --- | --- | ---: | ---: | --- | --- |
| ETH | 2026-03-17T00:00:00.000Z | 2026-03-22T12:00:00.000Z | -131415.07 | 11 | trend-close>sma40|mom20-ok|eff-ok|retq22-off | risk-off |
| PENGU | 2025-07-30T00:00:00.000Z | 2025-08-02T00:00:00.000Z | -126275.94 | 6 | strict-extra-rotate-close>sma40|mom20-ok|eff-ok|retq22-off|idle-extra | sma-break |
| ETH | 2026-01-15T12:00:00.000Z | 2026-01-20T12:00:00.000Z | -87622.59 | 10 | trend-close>sma40|mom20-ok|eff-ok|retq22-off | sma-break |
| SOL | 2025-09-22T00:00:00.000Z | 2025-09-22T12:00:00.000Z | -79300.62 | 1 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | risk-off |
| AVAX | 2024-12-04T12:00:00.000Z | 2024-12-10T00:00:00.000Z | -66857.01 | 11 | trend-close>sma40|mom20-ok|avax-mom-ok|avax-vol-ok|eff-ok|retq22-off | trend-switch |
| PENGU | 2025-07-28T12:00:00.000Z | 2025-07-29T00:00:00.000Z | -56240.73 | 1 | strict-extra-rotate-close>sma40|mom20-ok|eff-ok|retq22-off|idle-extra | trend-switch |
| ETH | 2025-06-04T00:00:00.000Z | 2025-06-06T00:00:00.000Z | -52878.93 | 4 | trend-close>sma40|mom20-ok|eff-ok|retq22-off | risk-off |
| DOGE | 2025-09-21T00:00:00.000Z | 2025-09-22T00:00:00.000Z | -37949.6 | 2 | strict-extra-rotate-close>sma40|mom20-ok|eff-ok|retq22-off|idle-extra | trend-switch |
| DOGE | 2025-01-07T12:00:00.000Z | 2025-01-08T00:00:00.000Z | -31872.59 | 1 | strict-extra-rotate-close>sma40|mom20-ok|eff-ok|retq22-off|idle-extra | risk-off |
| PENGU | 2026-01-05T12:00:00.000Z | 2026-01-10T00:00:00.000Z | -29609.56 | 9 | strict-extra-rotate-close>sma40|mom20-ok|eff-ok|retq22-off|idle-extra | trend-switch |

## Improvement Hypotheses

- USDT待機が長いです。特に最長 86.5 日の待機があり、候補通貨不足またはエントリー条件が厳しすぎる可能性があります。
- 決済の遅れで含み益を削っている可能性が高いです。SMA割れまで待つ出口が重いかもしれません。
- ETH の負けが目立ちます。この銘柄だけ出口や採用条件を個別調整する余地があります。
- USDT待機が長い場合は、追加候補通貨を増やすより先に『待機が長かった期間の候補Score推移』を確認し、条件が厳しすぎるのか候補不足なのかを分けて対策するのが安全です。
- PENGUローテーション負けが一定数あるなら、`gap10 once` を維持したままでも『直近2本の出来高比』や『PENGU自身のmomAccel下限』を足してダマシを減らす余地があります。
- 通常候補の負けが多いなら、銘柄別に出口を軽くするより、まず『負けが多い銘柄だけ個別の採用条件を1段厳しくする』方がPFを壊しにくいです。

## Files

- trade_events: C:\Users\dis\-ai-dex-manager\reports\current-production-max-window\retq22-trade_events.csv
- trade_pairs: C:\Users\dis\-ai-dex-manager\reports\current-production-max-window\retq22-trade_pairs.csv
- equity_curve: C:\Users\dis\-ai-dex-manager\reports\current-production-max-window\retq22-equity_curve.csv
- summary: C:\Users\dis\-ai-dex-manager\reports\current-production-max-window\retq22-summary.json