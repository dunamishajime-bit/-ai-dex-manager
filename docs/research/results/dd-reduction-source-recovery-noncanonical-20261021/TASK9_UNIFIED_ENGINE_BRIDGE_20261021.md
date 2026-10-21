# Task9：旧8ロジックBT + 新動的リプレイの統合ブリッジ（2026-10-21）

STATUS: UNIFIED_RESEARCH_BRIDGE_COMPLETE_DYNAMIC_PARITY_BLOCKED

旧8ロジックの価格モデルを唯一の研究用経済正本とし、同じ候補ソースとSTOP規則を新Task9に流す統合入口を作成した。2つのBT計算結果を合算したものではない。

## 接続・検証済み
- 共通policy JSONは config/research/task9-unified-v12-short-20261021.json 。V12 SHORT・2.5%逆行・エントリー12時間経過後開始・MFE1%未満をPython/TypeScriptで共有。新Task9側でopt-inでき、既定の8ケースを変更しない。
- 一つの入口: python -B scripts/dd-reduction/run-task9-unified-research-20261021.py --refresh-model
- 8ロジック価格モデル・35銘柄422ZIP・10bps/30bpsの正本一致・2.5%候補の研究結果を維持。
- 新Task9の候補源は元8ロジックのcandidate-decisions.jsonlを直接参照。両コストで新Task9を実行した。
- 両コストとも新Task9はBLOCKED_INCOMPLETE_SOURCE_COVERAGE。経済指標・LIVE認証は出していない。
- productionChanges=0/liveChanges=0。

## 未統合で残る必須の実装
1. 候補3185件のevent_seq/priority/entry_valid_until_ms/worst_case_grossを旧エンジンが一次証拠として出力する必要がある。Acceptedの一部数量は存在するが、Rejectedのロットとその時点の口座状態が不足。
2. ENTRY決定直前の時系列状態と予算・Gross・資金予約、発火順位、拒否理由を旧エンジンから供給し、推定値を埋めずに新Task9へ渡すこと。
3. STOP保護注文、部分約定、STOP成立後のcooldown、gross再割当、H1/5m MTM価格マークを単一の時系列で再生すること。
4. 10bps/30bpsの全候補・約定・PnL・Wallet・MTM・DDのfirst-divergence照合が通るまで新Task9による経済数値を正式結果として出さないこと。
5. IS/OOS/Holdout境界と未使用期間での検証を行うこと。

## 判定
統合入口と共通政策は実装・実行済み。経済計算と完全ライフサイクルの統合、および新Task9との数値完全一致は未完了。旧LIVE・VPS・HP・注文は未変更。
