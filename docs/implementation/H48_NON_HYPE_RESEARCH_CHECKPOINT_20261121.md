# H48 — HYPE以外のRunnerへの適用検証（2026-11-21）

## 結論・適用ゲート

**本番への一律適用は保留。** HYPEの既存実装・証明書・承認・注文設定を変更しない。

H48は現在HYPE用に存在する「48時間の時刻出口（TIME_ONLY）」を指す。HYPE以外への展開には、以下の異なる政策を分けた検証が必要。

1. **TIME_ONLY 48h**：既存の出口を48時間後に置き換える。早期STOPや既存の利益確定・Fail Closedを消す危険があるため、この価格比較だけで採用しない。
2. **MAX_HOLD 48h**：既存の早期EXIT/STOP/TPを維持し、48時間超の取引だけ短縮する。モデル約定に対する価格比較はできるが、エントリー選別と将来の建玉が変化するため正式BTではない。
3. **各ロジック固有のExit＋H48安全補助**：EXIT条件を保持し、各Runner／通貨の利益・最大DDを本番一致の統合再実行で評価する。

対象は **V4、PENGU、Q102、V52、FET、IDLE**。HYPEは除外。期間2025-10-01〜2026-10-01 UTC、10bps/30bpsは別モデル。

## 監査可能な成果物

- [TIME_ONLY出口価格比較スクリプト](../../scripts/research/audit_bt_nonhype_h48_fixed_entries.py)
- [MAX_HOLD 48hの価格比較スクリプト](../../scripts/research/audit_bt_nonhype_h48_cap48.py)
- [MAX_HOLD 48hのJSON台帳・各元データSHA256](../research-results/H48_NON_HYPE_HOLD_CAP48_FIXED_FILLS_20261121.json)
- テスト: `tests/test_bt_nonhype_h48_fixed_entries.py`、`tests/test_bt_nonhype_h48_cap48.py`。PC隔離ディレクトリで計7件PASS。
- 入力: PC `C:\tmp\disdex-bt-20251001-20261001\STABLE4_OPPORTUNITY_PROD_CAPS_20261114` のモデル約定・`aster-public-v3-h1` のH1価格。生データと出力のSHA256はJSON台帳参照。

### MAX_HOLD 48h：モデル約定を固定した比較

| Runner | 10bps 全件 | 48hで短縮 | 10bps 従来→上限48h 勝率 | 10bps 固定建玉価格損益差 | 30bps 固定建玉価格損益差 |
|---|---:|---:|---:|---:|---:|
| V4 | 801 | 109 | 62.80% → 62.30% | +174,716円 | +54,739円 |
| PENGU | 45 | 18 | 75.56% → 75.56% | -1,033,900円 | -468,973円 |
| Q102 | 106 | 4 | 60.38% → 60.38% | -894,624円 | -405,526円 |
| V52 | 52 | 4 | 84.62% → 84.62% | +49,879円 | +24,935円 |
| FET | 8 | 0 | 50.00% → 50.00% | 0円 | 0円 |
| IDLE | 10 | 0 | 70.00% → 70.00% | 0円 | 0円 |

**重要:** 上表の円は固定建玉に同じ価格リターン差を掛けた*名目価格損益差*であり、最終口座残高、複利増減、実約定利益ではない。手数料、Funding、数量再計算、保有中のMTM、Gross制限、他ルートの候補、共有Risk、証拠金、安全停止、連続約定を再計算していない。PENGUは部分決済などにより**3件の元台帳PnLと単純価格PnLが一致しない**。

また、V52の48時間超の4件には `MISSED_CHECKPOINT_FAIL_CLOSED` と最長約2,302時間のモデル持越しがあり、単純なリターン比較から除外せず、元エンジンの再現性を優先確認する。

### TIME_ONLY 48h：既存出口を丸ごと置換した場合

単純な価格比較ではFET 10/30bpsとも勝率50.0%→62.5%だが、**全8件は元モデルで24時間以内に決済**、うち5件は `FET_PROTECTED_STOP`。TIME_ONLYを機械適用するとSTOPを上書きすることになる。この8件を根拠にFETを本番採用しない。

## 残タスク：正式な利益・最大DDの比較

1. 現行Productionの各Runnerピン（SHA、ポジション出口コード、STOP更新、partial・reduce-only、継続判定）とBTエンジンの出入口を一件ずつ照合。**HYPEは現行のまま固定**。
2. 同じ元市場データで **基準BT / TIME_ONLY 48h / MAX_HOLD 48h / Exit＋H48補助**を別個に再実行。各エンジンが未来値参照・欠損足を拒否することを確認。
3. 各ケースでエントリー候補再判定、時間順約定、未決済残高、Funding、10/30bps、STOP・TP・ハードSTOP、同時建玉、symbol ownership、Gross Crypto3.0x・Stock1.5x・Total3.5x、共有日次損失7.5%、GLOBAL HOLD、Q102/runner固有ゲート、初期資金10,000円・複利を完全再計算。
4. **利益額・最終資産・最大DD・勝率・PF・ワースト損失・取引件数・不整合件数**をRunner/銘柄別＋総合で保存。最大DD20%を超える候補は採用しない。
5. 期間外／人工相場／walk-forward／閾値揺らし／学習-評価の分離で過学習を検査。約定明細、入力SHA、Commit SHA、CI証跡を保存。
6. 検証PASSの候補だけを別PRで本番実装し、Ownerの**対象目的に対する正式承認**と安全ゲート経由で切り替える。既存HYPE承認の流用は禁止。

## 現時点の状態

`RESEARCH_ONLY / DD_NOT_RECALCULATED / NO_PRODUCTION_CHANGE / HYPE_UNCHANGED`

この資料と価格比較だけを根拠としたRunner新規注文権限、STOP、GLOBAL HOLD、承認スコープの変更は行わない。
