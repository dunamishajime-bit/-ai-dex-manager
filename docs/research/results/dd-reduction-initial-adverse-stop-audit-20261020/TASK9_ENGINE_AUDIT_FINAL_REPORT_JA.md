# Task 9 研究エンジン監査・初期逆行STOP再検証 最終報告

## 1. 判定

**STATUS: RESEARCH_ONLY_NONCANONICAL**

Production / VPS / LIVE / HP / operator artifact / Aster実口座は変更していない。実注文・取消・建玉変更も0件である。

今回の修正後結果は、過去の `-12.9980%` / `-14.0069%` という旧研究値を正式値として維持しない。旧値は、固定Accepted台帳へ重ねた複合Overlayと、単位が混在したPF集計を含むため、修正後の正規化結果とは別物である。

今回確定した最良の固定台帳研究シナリオは、次の2 Overlayである。

1. `V12_SHORT_PCT2P0_12H_MFE1P0_R12`
2. `V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12`

ただし、これは既存Accepted台帳を固定した `FIXED_ACCEPTED_LEDGER_LIFECYCLE_OVERLAY` であり、STOP後の未採用Candidate再選定、動的Lot再計算、全候補の因果的再Admissionを行う完全動的BTではない。動的再Replayは未実装として明示的に保留している。

## 2. 固定条件

| 項目 | 条件 |
| --- | --- |
| 期間 | 2025-08-10〜2026-08-10 |
| 初期資金 | ¥10,000 |
| 積立 | なし |
| 複利 | あり |
| 構成 | 2026-10-17固定8ロジック統合 |
| 価格モデル | H1 price-model replay、初期逆行判定は保存済み5分足 |
| コスト | 10bps / 30bps |
| 研究ブランチ | `codex/task9-engine-audit-dd-research-20261020` |
| 研究契約 | `FIXED_ACCEPTED_LEDGER_LIFECYCLE_OVERLAY` |
| Production変更 | 0 |

このBTは実Aster約定認証ではない。Historical L2約定、実STOP約定、実部分約定を証明するものではない。

## 3. PnL単位修正とBaseline再現

Canonical行の `total_pnl_jpy` は、フィールド名に反して決済通貨単位（この台帳ではUSD）の値だった。修正後は以下を分離した。

- `total_pnl_settlement`: 原台帳の決済通貨建てPnL
- `modeled_realized_pnl_jpy_at_exit_fx`: Exit時FXで円換算したPnL
- `total_pnl_jpy`: 修正後は明示的なJPY値
- `pnl_unit`: `JPY`
- `settlement_pnl_unit`: `SETTLEMENT`

従来PFは旧Settlement単位で再現し、研究上の主PFはJPY単位で再計算した。数値を旧PFへ合わせる補正は行っていない。

| 指標 | 10bps | 30bps |
| --- | ---: | ---: |
| Final equity | ¥222,818,966.8780 | ¥124,289,206.8183 |
| 旧Settlement PF | 3.4587962777 | 3.0785603082 |
| 修正後JPY PF | 3.4624474030 | 3.0820985073 |
| Maximum MTM DD | -15.6206368% | -16.7877688% |
| Closed trades | 1,310 | 1,307 |
| Accounting | PASS | PASS |
| Final / trades / DD | PASS | PASS |
| 旧Settlement PF parity | PASS | PASS |

独立Accounting突合も実施した。イベントCashflowを再合計したWalletとイベント記録Walletの差は、10bpsで `2.33e-10` Settlement、30bpsで `0`、未知イベント0件、イベントWallet mismatch 0件だった。

## 4. P0監査・修正

### P0-1 元勝敗判定

修正済み。明示的JPY PnLを優先し、決済通貨のlegacyフィールドをそのまま勝敗へ使用しない。PnL欠落は `UNSETTLED` とし、LOSSへ暗黙変換しない。STOP監査には元Position ID、元Exit、元PnL、元Outcome、STOP後PnL、差額を保存した。

### P0-2 Cooldownの時間逆転

修正済み。Cooldown候補は `stop_ts <= entry_ts` のSTOPだけに限定し、未来のSTOPで過去Entryを拒否しない。履歴キーにOverlay IDも含め、別OverlayのSTOPが相互にCooldownを作らないようにした。未採用Candidate、Gross不足、優先順位拒否はCooldown源にならない。

回帰テストで次を確認した。

- 未来STOPは過去Entryを拒否しない
- STOP以前の実STOPだけがHoldoffを作る
- 未約定CandidateはCooldown源にならない
- same-directionの再EntryだけがHoldoff対象になる

### P0-3 STOPと資金再配分

固定Accepted台帳内では、STOPをLifecycleイベントへ展開し、STOP後の資金解放、既存建玉、部分Exit、二重Exit、後続Entry、MTMを再計算した。AccountingはPASS。

ただし、STOPで空いた枠へBaseline拒否Candidateを昇格する動的再Admissionは未実装である。したがって、固定台帳結果を完全なProduction-equivalent統合BTとは扱わない。

### P0-4 価格補正と構造判定

修正済み。STOP判定と構造判定へ同じ補正後Entry価格を渡す。確定5分足だけを使い、未確定足・未来バーを参照しない。H1 MTMはCanonical定義に合わせてH1 Openを使用する。

Stock系 `AMZNUSDT / METAUSDT / MSFTUSDT / NVDAUSDT / TSLAUSDT` は凍結H1原本が不足するため、診断用に保存済み5分足からH1 fallbackを使用した。これは実venue証拠ではなく、制約としてManifestへ記録した。

### P0-5 Exit理由とPnL

予定Exitと実Exitを分離した。追加STOPで閉じた場合は `exit_reason_actual`、元Exitは `planned_exit_reason` として保持し、Stop後価格・コスト・PnL差分を別記録した。

### P0-6 OOS

OOSは実際のExit時刻順に並べ、境界を跨ぐTrade、既知PnL、未確定、PF、実現PnL、累積損益DDを分離した。なお、固定台帳候補の選定とOOS評価が完全独立した最終Holdoutではないため、OOS PASSはProduction認証ではない。

### P0-7 MTM DD

H1各評価時刻でWallet + Open Positionの未実現損益を復元した。Peak、Trough、Recovery、Open Position、Gross、同時建玉、上位DD Windowを保存している。Walletだけの実現損益DDを正式MTM DDとして扱っていない。

### P0-8 損失経路

以下を別集計した。

- Positive→Negative
- +1%→Negative
- +3%→Negative
- +5%→Negative
- 最終Loss after positive
- 最終Win after positive
- Breakeven複数回通過
- MFE / MAE / Giveback
- 初期足逆行、3本連続初期逆行

10bpsのBaseline診断では、Positive→Negative 1,045件、+1%→Negative 470件、+3%→Negative 113件、+5%→Negative 30件、最終Loss after positive 296件だった。これらを同一概念として扱っていない。

## 5. 50候補の修正後再検証

| 判定 | 件数 |
| --- | ---: |
| ACCEPTED | 3 |
| DD_IMPROVED_RESEARCH_ONLY | 2 |
| REJECTED | 45 |

ACCEPTED候補は次の3件。

1. `V12_SHORT_PCT2P0_12H_MFE1P0_R12`
2. `V12_SHORT_PCT2P0_6H_MFE0P5_R6`
3. `V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12`

`V12_SHORT_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12` は、既に同じ単純Overlayが存在するため修正後の追加DD改善が0となり、累積採用対象ではない。

DD_IMPROVED_RESEARCH_ONLYは次の2件。

- `V12_SHORT_PCT1P5_6H_MFE0P5_R12`
- `V12_SHORT_ATR1P5_6H_MFE0P5_R12`

## 6. 修正後の累積固定台帳結果

| 指標 | Baseline 10bps | 2 Overlay 10bps | 差分 | Baseline 30bps | 2 Overlay 30bps | 差分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Final equity | ¥222,818,966.88 | ¥207,774,666.51 | -¥15,044,300.37 | ¥124,289,206.82 | ¥112,830,123.14 | -¥11,459,083.68 |
| JPY PF | 3.462447 | 3.196193 | -0.266254 | 3.082099 | 2.760093 | -0.322005 |
| Maximum MTM DD | -15.6206% | -14.5080% | +1.1126pt | -16.7878% | -15.9648% | +0.8229pt |
| Win rate | 72.3664% | 69.1888% | -3.1776pt | 69.5486% | 66.6145% | -2.9341pt |
| Closed trades | 1,310 | 1,282 | -28 | 1,307 | 1,279 | -28 |
| OOS PF | 3.593058 | 3.276189 | -0.316869 | 3.214635 | 2.824939 | -0.389696 |
| Accounting | PASS | PASS | - | PASS | PASS | - |

この結果はDDを約1.11pt / 0.82pt改善するが、最終資産とPFを削る。したがって研究上は `DD_IMPROVED_RESEARCH_ONLY` として扱い、Production Baselineへ自動反映しない。

旧報告の `-12.9980%` / `-14.0069%` は、修正後の単位統一・重複Overlay除外・再計算結果では再現されない。旧値を採用判断へ使用しない。

## 7. V12 SHORT深掘り

修正後の `STOP 2% / arm 12h / MFE 1%` は、Cooldownを分離して比較した。

| 条件 | 10bps DD | 10bps Final | 10bps STOP / Cooldown | 30bps DD | 30bps Final | 30bps STOP / Cooldown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cooldown 0h | -15.4159% | ¥219,609,043 | 60 / 0 | -16.8642% | ¥121,862,955 | 60 / 0 |
| Cooldown 3h | -15.3214% | ¥219,690,576 | 59 / 3 | -16.7413% | ¥121,903,321 | 59 / 3 |
| Cooldown 6h | -14.8733% | ¥219,639,455 | 59 / 6 | -16.3178% | ¥121,878,642 | 59 / 6 |
| Cooldown 12h | -15.0615% | ¥219,431,689 | 59 / 14 | -16.5327% | ¥122,034,687 | 59 / 14 |
| Cooldown 24h | -15.1546% | ¥219,476,920 | 57 / 26 | -16.6292% | ¥122,063,326 | 57 / 26 |

Armを0h〜2hへ前倒ししたケースは10bps/30bpsともDDと資産が悪化した。単純な即時STOPは採用根拠にならない。

## 8. P3/P5診断

修正後Baselineの10bps診断では、最大Gross 5.07085x、最大同方向Gross 4.36907x、最大同時建玉13件、同一symbol/side含み損中追加102件、Preemption 123件だった。30bpsでは最大Gross 5.04479x、最大同方向Gross 4.64619x、含み損中追加99件、Preemption 125件だった。

最大DDは10bpsで `2025-12-05 19:00 UTC` Peak〜`2025-12-10 23:00 UTC` Trough、30bpsで同じPeak〜`2025-12-10 23:00 UTC` Trough。回復時刻・上位5 Window・Open Position・Grossは `p0-p3-p5-diagnostics` に保存した。

## 9. 動的Replayの未解決条件

今回の固定Replayは、早期STOPによる既存PositionのExit、資金解放、既存Accepted intentの後続イベント、MTMを検証できる。一方、次はまだ実装していない。

- STOPで空いたGrossへ、元Rejected Candidateを時系列再選定すること
- 新しいWallet/Equityから後続Candidateの数量を再計算すること
- Candidate順位・同時刻Tie-break・Shared Gross・Pending予約を全候補で再評価すること
- 動的再配分後の新しい候補から再びSTOP/Cooldownを生成すること
- 独立Holdoutで候補選定をせずに最終評価すること

このため `DYNAMIC_REPLAY_STATUS.json` を追加し、`BLOCKED_DYNAMIC_RESELECTION_NOT_IMPLEMENTED` と明示した。ここを実装しない限り、固定OverlayのDD改善をProduction相当の統合BTとは呼ばない。

### 動的Replayに必要な入力の実在性監査

現時点で成果物として存在するcandidate入力は、`core-reference-candidates.jsonl.gz` の2,484行（V12 1,978、Q102 372、PENGU 113、FET 21、SHA256 `99b8d5d3...1591e69`）と、V52専用の `candidate-decisions.jsonl` 99行（採用88、事前割当除外11、SHA256 `5345f828...cc5e1bc`）である。前者には候補の状態はあるが、全候補の共有Allocatorによる拒否理由・予約状態はない。

一方、基準1,310件にはRESIDUAL 29件、IDLE 71件、HYPE_LONG 34件、V52 87件が含まれるが、これら4系統の全候補イベント・拒否理由・pending reservationの一次台帳は今回の固定研究成果物内に存在しない。したがって、動的再Admissionを作るにはこの不足台帳が必要であり、既存のAccepted台帳や将来の損益から推測して補完することはしない。

## 10. テスト・再現性

- Python focused tests: **23/23 PASS**
- AST parse: **PASS**
- 全50候補修正後Replay: **完了 / exit code 0**
- V12 SHORT focused 16ケース: **完了 / exit code 0**
- P0/P3/P5 diagnostics 10bps/30bps: **完了 / exit code 0**
- 独立Accounting reconciliation: **PASS**
- Production変更: **0**
- 実注文・取消・建玉変更: **0**

大容量台帳とMTMはGitへ複製せず、次へ保存した。

`C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-20_dd-reduction-initial-adverse-stop-audit\fixed-ledger-replay`

主な成果物:

- `task9-fixed-replay-summary.json`
- `baseline-control-10bps.json`
- `baseline-control-30bps.json`
- `BASELINE/**/mtm/fixed-ledger-timeline.jsonl`
- `candidates/**/portfolio-trades.jsonl`
- `candidates/**/portfolio-events.jsonl`
- `focused-v12-short/v12-short-deep-summary.json`
- `p0-p3-p5-diagnostics/**`

## 11. 最終判断

今回のP0監査で、Cooldown未来参照、PnL単位混在、Accounting判定不足は修正・回帰検証できた。修正後の固定台帳研究では、V12 SHORTの12h/MFE条件にDD改善が残るが、利益とPFを削り、動的再配分も未実装である。

よって、現時点の正式判定は次のとおり。

**RESEARCH_ONLY_NONCANONICAL / BLOCKED_DYNAMIC_RESELECTION_NOT_IMPLEMENTED**

Production / VPS / LIVE / HP / operator artifactへ反映してはいけない。次の研究工程は、拒否Candidateを含む完全な因果Candidate event streamと、Shared Gross・Pending・動的Lotを持つ別Replayエンジンの実装である。
