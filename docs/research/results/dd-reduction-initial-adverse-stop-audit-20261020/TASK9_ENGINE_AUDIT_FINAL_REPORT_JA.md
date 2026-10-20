# Task 9 研究エンジン監査・初期逆行STOP再検証 最終報告

## 1. 結論

**STATUS: RESEARCH_ONLY_NONCANONICAL**

Task 9 の研究エンジンを監査・修正し、固定受入台帳を使った因果的な再生で、Baseline と従来の50候補を再検証した。研究結果としては、V12 SHORT の複合候補が統合最大MTM DDを改善したが、これは研究用の候補であり、Production、VPS、LIVE、HP、operator artifact には反映していない。

Production変更件数は **0**、実注文・取消・建玉変更は **0**。

### 最重要結果

- 固定Baselineの10bps / 30bpsは、最終資産、PF、取引数、修正済みH1 MTM DD、Accountingの全項目で再現した。
- 50候補の再検証結果は **ACCEPTED 3件、DD_IMPROVED_RESEARCH_ONLY 2件、REJECTED 45件**。
- 最良の累積研究候補は "V12_SHORT_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12"。
- この候補を累積統合した研究結果は、10bpsでDD -15.6206% → -12.9980%、30bpsで -16.7878% → -14.0069%。
- ただし候補は、既存8ロジックの受入済み台帳へ研究用Overlayを重ねた RESEARCH_ONLY_NONCANONICAL であり、Production契約・実取引所ライフサイクル認証・LIVE採用を意味しない。

## 2. 固定条件と再現性

| 項目 | 条件 |
| --- | --- |
| 期間 | 2025-08-10 ～ 2026-08-10 |
| 初期資金 | ¥10,000 |
| 積立 | なし |
| 複利 | あり |
| エンジン | H1 price-model replay |
| コスト | 10bps / 30bps |
| 基準Commit | 60c7793bf25f1e82059c25e9c4d840b8dbade9f7 |
| Replay契約 | FIXED_ACCEPTED_LEDGER_LIFECYCLE_OVERLAY |
| 実運用認証 | なし。研究結果としてのみ扱う |

固定台帳は、候補を再選別・再昇格するのではなく、既にAcceptedとなっているBaseline trade ledgerへ時系列Overlayを適用した。BaselineでRejectedだった候補を、Overlayによって新たに発注済みとして扱っていない。

## 3. Baseline parity

### 10bps

| 指標 | 固定基準 | 修正後再現 | 判定 |
| --- | ---: | ---: | --- |
| Final equity | ¥222,818,966.88 | ¥222,818,966.8780 | PASS |
| PF | 3.458796 | 3.4587962777 | PASS |
| Maximum MTM DD | -15.6206% | -15.6206368129% | PASS |
| Closed trades | 1,310 | 1,310 | PASS |
| Accounting | PASS | PASS | PASS |

### 30bps

| 指標 | 固定基準 | 修正後再現 | 判定 |
| --- | ---: | ---: | --- |
| Final equity | ¥124,289,206.82 | ¥124,289,206.8183 | PASS |
| PF | 3.078560 | 3.0785603082 | PASS |
| Maximum MTM DD | -16.7878% | -16.7877687749% | PASS |
| Closed trades | 1,307 | 1,307 | PASS |
| Accounting | PASS | PASS | PASS |

修正済みMTMは凍結H1バーの各時刻のOpenを使用し、BaselineのCanonical Engine DDと一致した。Baseline parityは数値合わせではなく、Ledger、Event、Accounting、MTM scheduleの一致として確認した。

## 4. P0監査・修正結果

### P0-1 元勝敗判定

候補・約定済み行を分離し、損益を WIN / LOSS / FLAT / UNSETTLED に分類した。損益フィールド欠落をLOSSとして扱わず、未確定として分離した。STOP発動時には元Position ID、元Exit、元確定損益、元Outcome、実STOP後損益を保存する。

### P0-2 Cooldown

Cooldownの根拠をAccepted Positionの実際のExitへ限定した。Gross不足、優先順位、Preemptionで未採用となったCandidateはCooldownを発生させない。AuditにはEntry時刻、Origin Exit時刻、再Entry可能時刻、STOPからの経過時間、拒否理由を保存する。

Cooldown 0hでも28件の拒否が残ったが、その多くはSTOP後の保留時間ではなく、Baseline台帳における同一銘柄・方向の既存占有と重なる履歴であり、elapsed_hours_from_stop < 0 だった。STOP件数とCooldown件数は同一概念として集計していない。

### P0-3 STOPと再配分

Accepted ledgerを時系列イベントへ展開し、STOP後の資金・Gross解放、後続Entry、既存建玉、同時刻のExit/Entry、二重Exitを同一Replayで処理した。未約定行へのSTOPは生成していない。AccountingはBaseline・候補ともPASS。

### P0-4 価格補正・構造判定

apply_initial_stop と structure_confirmed の価格基準を統一し、補正後のEntry価格を構造判定にも渡すよう修正した。H1 MTMは固定Open、補助的5分足診断はCloseを使用し、未確定足・未来バーを参照しない。Stock系H1不足は保存済み5分足を診断用H1 fallbackとして使用し、対象と制限をManifestへ明記した。

### P0-5 Exit理由

予定Exitと実Exitを分離した。元Exit予定時刻・理由、実STOP時刻・理由、元想定PnL、STOP後PnL、差額、Position ID、Candidate ID、約定価格、コストをLedger/Auditへ保存した。

### P0-6 OOS

OOSは実際のExit時刻で時系列ソートし、OOS境界を跨ぐTrade、既知PnL、未確定、Net PnL、PF、勝率、累積損益DDを分離集計した。BaselineとCandidateで同一境界を使用し、Candidate選択と最終認証を同じOOSへ繰り返し適用していない。

### P0-7 正確なMTM DD

全H1評価時刻に、Wallet + Open Positionの未実現損益を再構成した。Peak、Trough、Recovery、Open Position、Gross、同時建玉、上位5つの独立DD Windowを保存した。ウォレット残高だけの近似を正式MTM DDとして使用していない。

### P0-8 損失経路

Positive-to-Negative、+1%以上からNegative、+3%以上からNegative、+5%以上からNegative、最終Loss / 最終Win、損益分岐点の複数回通過、MFEからExitまでのGiveback、初期逆行、3本連続初期逆行を分離して算出した。

Baseline 10bps全体では、Positive-to-Negative 1,045件、+1%からNegative 470件、+3%からNegative 113件、+5%からNegative 30件、最終Loss after positive 296件だった。これらを同じ「利益から損失へ転落」とは扱っていない。

## 5. 50候補の再検証

| 判定 | 件数 |
| --- | ---: |
| ACCEPTED | 3 |
| DD_IMPROVED_RESEARCH_ONLY | 2 |
| REJECTED | 45 |

ACCEPTED:

1. V12_SHORT_PCT2P0_12H_MFE1P0_R12
2. V12_SHORT_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12
3. V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12

DD_IMPROVED_RESEARCH_ONLY:

1. V12_SHORT_PCT1P5_6H_MFE0P5_R12
2. V12_SHORT_ATR1P5_6H_MFE0P5_R12

Phase別の累積採用:

- V12 LONG: なし
- V12 SHORT: V12_SHORT_PCT2P0_12H_MFE1P0_R12
- Q102: なし
- Idle: なし
- FET: なし
- HYPE: なし
- V52: なし
- V12 SHORT composite: V12_SHORT_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12
- その他のComposite phase: なし

## 6. 最良累積研究候補

最良累積構成は、次の2つをPhase順に適用したものとして保存されている。

- V12_SHORT_PCT2P0_12H_MFE1P0_R12
- V12_SHORT_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12

この累積結果は、同じV12 SHORT領域へ複数の研究Overlayを重ねた研究シナリオである。Productionへそのまま移植してよいという意味ではない。単一候補単独の採否と累積Phaseの結果を混同しないこと。

### 10bps

| 指標 | Baseline | 最良累積候補 | 差分 |
| --- | ---: | ---: | ---: |
| Final equity | ¥222,818,966.88 | ¥230,257,745.09 | +¥7,438,778.22 |
| PF | 3.458796 | 3.832445 | +0.373649 |
| Maximum MTM DD | -15.6206% | -12.9980% | +2.6227pt |
| Win rate | 72.3664% | 73.8702% | +1.5038pt |
| Closed trades | 1,310 | 1,217 | -93 |
| OOS PF | 3.58949 | 4.046825 | +0.457334 |
| OOS net PnL | ¥1,121,832.56 | ¥1,164,269.19 | +¥42,436.63 |
| OOS判定 | - | PASS | - |

### 30bps

| 指標 | Baseline | 最良累積候補 | 差分 |
| --- | ---: | ---: | ---: |
| Final equity | ¥124,289,206.82 | ¥128,761,458.14 | +¥4,472,251.32 |
| PF | 3.078560 | 3.378958 | +0.300398 |
| Maximum MTM DD | -16.7878% | -14.0069% | +2.7809pt |
| Win rate | 69.5486% | 71.3932% | +1.8446pt |
| Closed trades | 1,307 | 1,213 | -94 |
| OOS PF | 3.211369 | 3.557997 | +0.346628 |
| OOS net PnL | ¥661,219.76 | ¥685,811.66 | +¥24,591.90 |
| OOS判定 | - | PASS | - |

会計整合性は両コストでPASS。取引数減少は、未採用Candidateを後から補充した結果ではなく、Accepted Positionに対するSTOP・同一所有権・再Entry保留・Gross解放の結果である。

## 7. V12 SHORT深掘り

固定STOP 2%、MFE 1%、Arm 12hを基準に、CooldownとArm時刻を分離した。

| 条件 | 10bps DD | 10bps Final | 10bps Trades | 30bps DD | 30bps Final | 30bps Trades |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| STOP + Cooldown 0h | -14.2559% | ¥222,597,154 | 1,282 | -15.6320% | ¥123,458,836 | 1,279 |
| STOP + Cooldown 3h | -14.8996% | ¥222,685,893 | 1,281 | -16.2492% | ¥123,503,481 | 1,278 |
| STOP + Cooldown 6h | -14.4211% | ¥222,634,772 | 1,278 | -15.7938% | ¥123,478,802 | 1,275 |
| STOP + Cooldown 12h | -14.6088% | ¥222,427,006 | 1,270 | -16.0079% | ¥123,634,847 | 1,267 |
| STOP + Cooldown 24h | -14.7023% | ¥222,481,809 | 1,259 | -16.1046% | ¥123,668,863 | 1,255 |

Arm時刻を0h～3hへ前倒ししたケースはDD・資産の両面で悪化した。単純な即時STOPは採用根拠にならない。3～6hの単純ATR候補も悪化し、V12 SHORTでは12hの初期情報蓄積とMFE条件が重要だった。

単純な採用候補 V12_SHORT_PCT2P0_12H_MFE1P0_R12 では、10bpsでSTOP 53件、元Winner STOP 22件、元Loser STOP 31件、Cooldown reject 40件。30bpsではSTOP 54件、元Winner STOP 21件、元Loser STOP 33件、Cooldown reject 40件だった。

## 8. 損失経路・最大DD診断

10bpsの全体診断:

- max gross: 5.07085x
- 最大同方向Gross: 4.36907x
- 最大同時建玉数: 13
- 同一Symbol/Sideの含み損中追加: 102件
- Preemption: 123件
- 初期逆行: 1,199件
- 3本連続初期逆行: 375件
- Positive-to-Negative: 1,045件
- +1%からNegative: 470件
- +3%からNegative: 113件
- +5%からNegative: 30件
- 最終Loss after positive: 296件

30bpsの全体診断:

- max gross: 5.04479x
- 最大同方向Gross: 4.64619x
- 最大同時建玉数: 13
- 同一Symbol/Sideの含み損中追加: 99件
- Preemption: 125件

10bps最大DD:

- Peak: 2025-12-05 19:00 UTC
- Trough: 2025-12-10 23:00 UTC
- Recovery: 2025-12-13 19:00 UTC
- DD: -15.6206368%

30bps最大DD:

- Peak: 2025-12-05 19:00 UTC
- Trough: 2025-12-10 23:00 UTC
- Recovery: 2025-12-13 20:00 UTC
- DD: -16.7877688%

上位5つの独立DD Window、各時刻のOpen Position、Wallet/Unrealized、Gross、ロジック別損益は p0-p3-p5-diagnostics 配下の台帳へ保存した。

## 9. 研究上の判断

単純な固定STOPを全ロジックへ広げるのは不適切だった。V12 SHORTの12h/MFE/構造条件は、10bps・30bps双方でDD改善とOOS PFを示したため、研究上の有望候補として残す。

一方、研究候補のAcceptanceはProduction採用の承認ではない。V12 V4/全Production Runnerの実装契約、実取引所でのSTOP設置・約定・再保護・再起動復元、部分約定、同時刻EXIT/ENTRY、rate budget、明示的Operator承認が別途必要である。

このため、今回の成果だけで本番へ変更していない。ユーザー承認なしにProduction実装、VPS反映へ進めない。

## 10. 成果物

大容量の台帳・MTM timeline・候補別イベントは、Git管理対象へ複製せず、次の研究出力へ保存した。

C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-20_dd-reduction-initial-adverse-stop-audit\fixed-ledger-replay

主な成果物:

- task9-fixed-replay-summary.json
- baseline-control-10bps.json
- baseline-control-30bps.json
- BASELINE/10bps/mtm/fixed-ledger-timeline.jsonl
- BASELINE/30bps/mtm/fixed-ledger-timeline.jsonl
- candidates/**/portfolio-trades.jsonl
- candidates/**/portfolio-events.jsonl
- candidates/**/mtm/fixed-ledger-timeline.jsonl
- p0-p3-p5-diagnostics/**
- focused-v12-short/v12-short-deep-summary.json

研究用リポジトリ内には、再実行コード、テスト、Manifest、最終報告のみを保存し、巨大な生成台帳をGitへ追加していない。

## 11. 制約・未解決

- これはH1 price-model replayであり、実取引所の約定証明ではない。
- Stock系の凍結H1ソース不足は、診断時のみ保存済み5分足からH1 fallbackを使用した。対象シンボルは AMZNUSDT / METAUSDT / MSFTUSDT / NVDAUSDT / TSLAUSDT。このfallbackは実venue証拠ではない。
- 既存のroot-owned scripts/dd-reduction/__pycache__ は削除せず保全したため、py_compile のバイトコード書込みは権限エラーとなる。AST parse、Focused unittest、研究実行はPASSしている。権限のある保守担当が既存キャッシュを整理するまで、py_compileの完全PASSとは報告しない。
- Production、VPS、LIVE、HP、operator artifact、実口座は変更していない。
