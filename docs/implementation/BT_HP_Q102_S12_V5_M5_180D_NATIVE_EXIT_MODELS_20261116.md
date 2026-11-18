# PR #481 / BT-481-M — Q102 S1/S2旧6銘柄・人工v5 M5→H1→180d Native Exit（2026-11-16）

## 判定

**`PASS_M5_TO_H1_NATIVE_MODEL_ONLY`**：人工市場の5分足から1時間確定足を作り、Q102 Nativeルール・72h出口・モデル費用・180日月次Selectorの研究経路を接続した。実Aster市場の約定履歴再現や正式S1/S2所属ID証明ではない。**本番S1/S2シグナル0 / 注文0 / 本番BT経済パリティ未認証**。

## 出所と時間窓

- Synthetic feed **v5** のみ実行可能上限を **53,000→60,000 M5 tick** へ拡張。v1～v4の上限53,000と各既存フィード経路は維持。予期しないデータ肥大化を避け、Node上限heap1,536MBを明示して再現した。
- seed 20261116 / `volatile` / 38銘柄（暗号資産30＋株8）。旧S1/S2 fixtureの6通貨（ONDO/TAO/SUI/OP/SEI/ARB）を対象。上流の30 Expanded Stage IDとは別の**未認証な代用シンボル集合**。
- 月次Selector対象：2026-03-01 00:00 UTC。モデル学習前180日と、前14日=336Hウォームアップ。Synthetic開始 **2025-08-19 00:00 UTC**、研究終了 **2026-02-28 23:00 UTC**（その直前H1足まで、未来市場足を入力しない）。
- Synthetic 5分足 **55,860 tick**、各通貨で完成した連続H1 **4,655本**。H1は12 M5足を束ねて完成後にしか使わない。取引所のM5本データとは無関係。
- 全て事前固定のグリッド合法ルール2本を**各銘柄の独立シナリオ**として試行。各ルールの保有重複は遮断。Portfolio one-slot / crypto Gross等との共通制御は未実行。

## 研究集計（代替ルール横断の延べ件数）

| Symbol | 重複込みRaw Grid Matches | 重複保有ブロック | 月末Open打切り | Native出口済モデル | 研究月次ルール |
|---|---:|---:|---:|---:|---|
| ONDOUSDT | 256 | 191 | 1 | 64 | 不採用 |
| TAOUSDT | 247 | 167 | 0 | 80 | 不採用 |
| SUIUSDT | 261 | 181 | 0 | 80 | 1件研究選択 |
| OPUSDT | 261 | 179 | 0 | 82 | 不採用 |
| SEIUSDT | 258 | 168 | 1 | 89 | 不採用 |
| ARBUSDT | 255 | 183 | 0 | 72 | 不採用 |
| **合計** | **1,538** | **1,069** | **2** | **467** | **研究選択1** |

**Raw1,538は重複閾値の条件一致**。**467は6通貨×各2代替ルールの研究決済モデル総数**で、正式なS1/S2の467注文、別々のPortfolio Fill、実市場の勝率・DDを意味しない。全て仮想生成相場の値で、選択された研究ルールもS1/S2上流Stage ID証明不足につき実際の入口へ昇格させない。

元Pinned Native source `7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f` の `computeQuality102HighVolFeatures` / `matchQuality102HighVolGrid` / `simulateQuality102HighVolExit` / `quality102NetFromGross` / `selectQuality102HighVolMonthlyRule` をそのまま使い、人工源のNative出口結果だけを監査した。元Normal研究費用 `perSide=0.0006, fundingPerDay=0.0002` であり、ユーザー指定の**統合10bps/30bps単独モデルではない**。

## 再現／非公開証跡

```powershell
cd C:\Users\dis\disdex-bt481-j-20261116
$env:NODE_OPTIONS='--max-old-space-size=1536'
$env:DISDEX_BT_PRIVATE_EVIDENCE_DIR='C:\Users\dis\disdex-bt481-private-evidence-20261116'
npx --yes tsx scripts/bt-hp-q102-v5-180d-m5-native-replay-selftest.ts
```

- 証拠JSON：`C:\Users\dis\disdex-bt481-private-evidence-20261116\BT481_Q102_S12_V5_180D_M5_NATIVE_EXIT_MODELS_20261116.json`。
- SHA256 `98AB4C2C56B3C97018A1EC7C38BDA512E4B69191E911C383417F468659D77BE2`。
- JSONにはモデル各行のentry・exit・方向・Native return・Ruleと時系列範囲を記載。GitHubへ個票市場台帳をPushせず、監査スクリプト・ソース・公開可能な上表のみ保管。
- `scripts/bt-hp-q102-v5-180d-m5-native-replay-selftest.ts`：旧v4期間上限を拒否、v5は55,860tickを許可、M5/H1完了時刻、全6シンボルのH1バー連続性、Native exit閉鎖時点、月次窓内での選抜、元ソースRule/Models、架空Portfolio/Orderが0の境界を監査。**PASS**。

## 残タスク

1. 元Q102の正式S1/S2 Expanded30・Stage1/2所属ID、Native monthly selectionと実市場候補の生成者SHA・再現可能台帳を確保。証拠が揃わない場合引き続き**BLOCK**。
2. 同価格ソースで3月以降の**未見Forward相場**へ凍結月次ルールを適用し、実現決済と右打切りを区別したWalk-forwardを実施。対象年の負けだけからルールを再選択しない。
3. Q102 one-slot、HYPE/V4/PENGU/他RunnerとのLayer3/Shared Risk/Gross、元手数料・Funding・STOP・venue Fillパリティを統合。10/30bps同時計算および口座DD≤20%/勝率改善を検証する。今回の467件を旧STABLE4の勝率や資産推移へ足さない。

PR #481 Draft。V4 Codex担当、正式LIVE/HP/注文/建玉/保護STOP/Kill Switch/Shared Riskへ変更なし。
