# STABLE4 × PENGU新SHORT V20（Binance → ASTER確定5分足）全口座BT：2026-11-23

## 判定

**新PENGU版は最大DD20%以内を満たさず、全口座最終資産も低下。研究段階ではSTABLE4の改善として不採用。**

## 前提

- 対象期間 2025-10-01 00:00 UTC〜2026-10-01 00:00 UTC（終端除外）、初期資金1万円、複利、往復手数料10bps／30bps。
- 研究版STABLE4：Crypto 3.0倍、Stock 4.0倍、全体Gross 4.25倍。これはP90の希望上限Stock1.5／Total3.5とは別条件。旧・新で同じ上限。
- PENGU SHORT V20のみ変更。旧STABLE4の入口Gate通過候補18件を除き、Binance確定H1発火→ASTER確定M5スコア→ASTERで約定すると仮定するP91の新4候補へ置換。通常0.75倍。4件すべて0.75倍。ASTER OR方式、15分審査、0.25倍不使用。
- PENGU LONG V64・Recovery V8、V4・Q102・HYPE・IDLE・FET・V52のソース設定は変更なし。全口座の5分刻み時系列を再計算。旧新とも研究モデルであり本番SHA/署名約定の完全一致とは主張しない。
- 比較基準の旧STABLE4は独立再実行で旧保存結果と10/30bpsの最終資産・DD・勝率・約定数・PFが一致。

## 統合BT結果

| 指標 | 旧10bps | 新10bps | 旧30bps | 新30bps |
|---|---:|---:|---:|---:|
| 最終資産（円） | 13,541,227 | 7,302,304 | 4,923,412 | 797,892 |
| 最大DD（%） | -21.57 | -21.57 | -22.28 | -22.49 |
| 勝率（%） | 63.90 | 63.97 | 61.82 | 63.73 |
| PF | 2.26 | 2.27 | 2.05 | 1.99 |
| 約定モデル件数 | 795 | 802 | 791 | 466 |

### DD21%・候補許可の連鎖

| 指標 | 10bps（旧→新） | 30bps（旧→新） |
|---|---|---|
| 初回DD21%超過 | 2026-03-02T06:55:00Z → 2026-03-02T06:55:00Z | 2026-03-02T06:55:00Z → 2025-11-10T10:00:00Z |
| V4約定モデル | 496→503件 | 494→132件 |
| DD21% HOLDでV4拒否 | 683→683件 | 683→1,214件 |
| PENGU全ルート約定モデル | 47→42件 | 46→42件 |
| PENGU SHORT V20約定モデル | 8→4件 | 7→4件 |

新PENGUのSHORT 4モデル取引は3損失・1利益。30bpsで最初のDD21%到達が2026年3月2日から2025年11月10日に前倒しされ、後続のV4許可件数が減少。旧取引の差額を引く方式ではなく、全Runnerの建玉・Funding・Shared Risk・Grossの状態を再計算した結果。

## V52データ検証

- 2025-10-01〜2026-09-30のASTER公式株式5分足を5銘柄×105,120本、計525,600本、SHA256付きで確認。Yahoo参照株価H1とASTER市場H1も存在。
- 旧STABLE4に採用されたV52の84件中、56件はエントリー時刻から次の5分足に取引0件。これは事後観測であり発注時の未来情報としては使わない。
- H1モデル入口価格と対応するASTER M5始値の差の絶対値：中央値 61.0bps、95%点 147.1bps。10/30bps手数料シナリオとは別の価格近似誤差。
- 過去の板・スプレッド・外部株価の受信時刻・実約定証拠は未確定。V52は全口座から除外していないが入口/出口は旧H1価格モデルであり、実約定を保証しない。

## 証拠と再現

- 全口座10/30bps、旧・新のモデル約定・Funding・注文採否・Shared Risk・5分刻みNAV・V52日次リスクを含む全台帳ZIP：STABLE4_REPLAY_PAIR_COMPLETE_RESEARCH_LEDGER_20261123.zip
- 同条件の旧STABLE4とPENGU差し替え再実行用Python：portfolio_stable4_gross425_independent_replay_20261123.py／portfolio_stable4_pengu_binance_aster_5m_20261123.py
- P90採用仕様：P90_PENGU_BINANCE_ASTERM5_ADOPTED_SPEC_20261122.md；P91新4件：PENGU_P91_4_BINANCE_M5_ADOPTED_INTENTS.jsonl
- Source/Output SHA256：STABLE4_PENGU_BINANCE_ASTERM5_10_30BPS_FINAL_RESEARCH_MANIFEST_20261123.json
- V52詳細：STABLE4_V52_84_H1_PROXY_VS_SAVED_M5_PRINT_DIAGNOSTIC_20261123.json；DD初回超過：STABLE4_PENGU_BIN5_FIRST_DD21_REPLAY_20261123.json

**本番VPS・実注文・STOP・Kill Switchへの変更0。**
