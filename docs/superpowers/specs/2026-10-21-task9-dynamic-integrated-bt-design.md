# Task 9: 全8ロジック動的統合BT設計仕様

## 1. 目的と境界

本仕様は、Task 9の固定Accepted台帳Replayを、候補生成からShared Allocator、約定、Exit、再配分、会計まで時系列で再現する研究専用の動的統合BTへ拡張するための設計である。

対象ロジックは V12、Q102、PENGU、FET、RESIDUAL、IDLE、V52、HYPE_LONG の8つとする。期間は 2025-08-10T00:00:00Z から 2026-08-10T00:00:00Z、初期資金10,000円、積立なし、複利、コスト10bps/30bpsとする。

本仕様は研究ブランチだけに適用する。Production、VPS、LIVE Runner、HP、Aster口座、operator artifact、Shared Risk、Margin Guard、Kill Switchは変更しない。

## 2. 成功条件

1. 8ロジックのCandidate Source Coverage Matrixを生成する。
2. Candidateごとに判定時点の入力、決定順、Allocator state before/afterを保存する。
3. Rejected Candidateを、未来情報なしで再評価できる。
4. pending/reserved Gross、同一symbol ownership、Cooldown、minQty/minNotionalを時系列で再現する。
5. Preemptionを因果イベントとして記録し、未証明ならPASSや0件として扱わない。
6. Dynamic Lot、fee、funding、slippage、FX、Wallet、Equityを独立再計算する。
7. OverlayなしDynamic Baselineの最初の差分を10bps/30bpsで特定する。
8. Baseline Exact Parityが成立しない場合、結果を正式Parityとは呼ばず再構築Baselineとして分離する。
9. V12 SHORT候補A/B/Cを単独・累積で再検証する。
10. 初期Baselineを基準にした累積OOS Gateと独立Holdoutを評価する。

## 3. 証拠区分

入力フィールドには次の証拠区分を付与する。

- ORIGINAL_EVIDENCE: 保存済み一次台帳・実在ファイルから直接取得。
- CAUSALLY_REGENERATED: 保存済み市場データと確定ロジックから未来情報なしで再生成。
- MISSING: 必須だが入力が存在しない。
- UNVERIFIABLE: 候補結果はあるが因果的生成根拠を確認できない。

MISSINGまたはUNVERIFIABLEの必須フィールドは推定値で埋めず、対象CandidateまたはケースをFail Closedする。

Baseline candidate-decisionsはBaseline実行時の観測結果として保存するが、Accepted/Rejected結果だけを動的Allocatorの正解として再利用しない。

## 4. Candidate Event契約

研究専用Candidate Eventは次を持つ。

- candidate_id、event_id、strategy_id、stage_id、route、family
- symbol、side、signal_ts_ms、decision_ts_ms、event_seq
- rank、score、priority、candidate_status、entry_valid_until_ms
- requested_gross、worst_case_gross、entry_price、entry_price_source
- planned_exit、source_sha、config_sha、data_sha、evidence_level

同一timestampの順序は、生成器のevent_seq、明示priority、rank、tie-break keyの順で決定する。順序情報がない場合、candidate_id順を過去Productionの正式順序とは扱わず、NONCANONICAL_ORDERINGとして記録する。

確定足条件、entry有効期限、価格、side、symbol、strategyの必須情報が欠けるCandidateはAdmissionしない。

## 5. Allocator State契約

各Decision前後に、Canonical JSONのSHA256で状態を固定する。

- state_hash_before、state_hash_after
- wallet_settlement、wallet_jpy、realized_pnl_settlement、realized_pnl_jpy
- unrealized_pnl_jpy、equity_jpy、available_margin
- total_gross、crypto_gross、gross_by_symbol、gross_by_strategy
- pending_gross、reserved_gross、strategy/symbol別pending/reserved
- open_position_ids、ownership_by_symbol
- cooldown_by_symbol_side_strategy、reservation_ids

状態更新は単一の時系列Reducerを通し、同一入力から同一状態を生成できることをテストする。

## 6. Event OrderingとAdmission

同一timestampの基本順序は次のとおりとする。Baseline Parityで一次証拠と異なる場合は証拠を優先し、Manifestへ記録する。

1. Deposit/Funding
2. Protective STOP
3. Preemption Exit
4. Normal Exit/Take Profit/Time Stop
5. Partial/Unknown execution reconciliation
6. Reservation release
7. Cooldown/ownership update
8. Candidate validity check
9. Candidate priority/tie-break
10. Preemption eligibility
11. Dynamic quantity calculation
12. Gross/margin reservation
13. Entry fill
14. Protection registration
15. State hash and ledger emission

同一timestampのSTOPとENTRYの順序が不明な場合、都合のよい順序を採用せず、SAME_TIMESTAMP_ORDER_UNVERIFIABLEとして正式比較から除外する。

Candidateは、期限、入力、ownership、方向競合、Cooldown、total/crypto/strategy/symbol Gross、pending/reserved Gross、equity/margin、minQty/minNotional、protection条件をすべて満たす場合のみAdmissionする。

Rejected理由は、ENTRY_EXPIRED、DATA_MISSING、SAME_SYMBOL_OWNERSHIP、OPPOSITE_SIDE_CONFLICT、COOLDOWN_ACTIVE、GROSS_CAP_TOTAL、GROSS_CAP_CRYPTO、GROSS_CAP_STRATEGY、PENDING_GROSS、RESERVED_GROSS、MARGIN_UNAVAILABLE、MIN_QTY、MIN_NOTIONAL、PRIORITY_LOST、PREEMPTION_NOT_ELIGIBLE、PROTECTION_UNVERIFIABLE、UNKNOWN_EXECUTION等へ分類する。

Rejected Candidateは、候補期限と判定時点の入力を再確認した場合のみ再評価する。最終損益や将来の勝敗は再評価条件に使用しない。

## 7. Preemption

Incoming Candidateと既存Positionのpriority、strategy契約、symbol ownership、protection状態を比較し、契約上許可された場合だけPreemptionする。

必須Ledger項目は、preemption_event_id、incoming_candidate_id、victim_position_id、victim strategy/symbol/side、timestamp、requested_gross、released_gross、exit quantity/price/cost、reason、cooldown_until、replacement_candidate_idとする。

Preemption後は、被PreemptionPositionのExit、Gross解放、Cooldown、Wallet/Equity更新を完了してからIncoming Candidateを再Admissionする。二重Exit、二重Release、無保護中間状態を許可しない。

## 8. Dynamic Lotと会計

Dynamic LotはDecision直前のWallet/Equity、strategy/shared Gross、fee/slippage reserve、margin reserve、minQty、minNotional、step size、priceから再計算する。

Settlement PnL、JPY PnL、FX、Wallet、Realized PnL、Unrealized PnL、Total Equityを別フィールドで保持する。

各イベントについて次を独立検証する。

wallet_after = wallet_before + deposits + realized_pnl_settlement - fees - funding - slippage

MTMはH1価格系列で全Open Positionを評価し、Peak、Trough、Recovery、Open Position、Gross、Net Exposureを保存する。

## 9. BTケース

Dynamic Baselineを先に実行し、その後に次を同一Allocatorで実行する。

- Baseline
- A: V12_SHORT_PCT2P0_12H_MFE1P0_R12
- B: V12_SHORT_PCT2P0_6H_MFE0P5_R6
- C: V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12
- A+C、B+C、A+B、source coverageを満たす最良組合せ

各ケースでSTOP発動数、元Winner/Loser、損失削減、失われた利益、Cooldown除外、Gross再配分Admission、Dynamic Lot、Preemption、最大同方向Grossを比較する。

## 10. Baseline、OOS、Holdout Gate

OverlayなしDynamic Baselineの期待値は、10bps Final ¥222,818,966.8780、JPY PF 3.4624474、1,310 trades、DD -15.6206368%、30bps Final ¥124,289,206.8183、JPY PF 3.0820985、1,307 trades、DD -16.7877688%である。

一致しない場合は、最初のCandidate ID、timestamp、strategy、decision、Gross、Wallet、Equity、rejection reasonを保存し、再構築Baselineとして明示する。数値補正でParityを作らない。

正式採用条件は、10bps/30bps双方のDD改善0.10pt以上、初期Baseline対比OOS PF保全率90%以上、Final Equity保全率75%以上、OOS Net PnLプラス、Accounting PASS、Dynamic Allocator/Preemption/Reservation整合性PASS、未来参照なし、独立Holdoutで極端な劣化なしとする。

Phase直前Baselineとの比較だけで最終採用を決めず、最終累積構成は初期Baselineと比較する。

## 11. テスト

Candidate生成因果性、欠損Fail Closed、重複ID、同時刻priority/tie-break、STOP/ENTRY順序、未来STOP防止、Cooldown、Gross release/re-admission、Pending expiry、Preemption whole/partial Exit、ownership、Dynamic Lot、minQty/minNotional、JPY/settlement分離、fee/funding/slippage、MTM DD、OOS境界、Holdout、Baseline parity、10bps/30bps、deterministic replayをテストする。

## 12. 成果物と安全境界

成果物はC:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/配下のrun-specific folderへ保存し、Gitにはコード、Manifest、レポートだけを保存する。

必須成果物はcandidate-source-coverage-matrix.json、candidate-events.jsonl、allocator-decisions.jsonl、allocator-state-snapshots.jsonl、reservation-ledger.jsonl、preemption-ledger.jsonl、execution-ledger.jsonl、mtm-timeline.jsonl、baseline-parity-report.json、overlay-comparison.json、oos-holdout-report.json、manifest.json、sha256-index.json、日本語最終レポートとする。

本作業ではProduction/VPS/LIVE/HP/Aster/operator artifact/Shared Risk/Margin Guard/Kill Switchを変更せず、実注文・取消・建玉変更を行わない。欠損値を将来損益から補完せず、正式条件未達は具体的なBLOCKED理由として報告する。
