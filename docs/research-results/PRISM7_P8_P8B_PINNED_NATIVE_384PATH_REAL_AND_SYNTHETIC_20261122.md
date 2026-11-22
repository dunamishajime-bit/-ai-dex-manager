# PRISM VII P8/P8B — 元PENGU固定SHA入口・STOPを人工市場で再演（2026-11-22）

**判定：元ソース53/53一致・384人工経路157自然SHORTの完全決済検算PASS。ただし人工モデルで77勝157件（49.045%）、目標80%未達。LIVE採用不可。**

対象はPENGU Short V20 source commit `1657e173d250ad58f53e62f7bb0a3428fb405496`。研究専用のPC隔離フォルダ `Documents/DisDex_Research/WINRATE_DEEP_20261122/pin_native_harness_20261122` で純関数コードを実行。現行Git master作業ツリーやVPSには書き込んでいない。

## 1. 元ソースの照合 — 53/53入口＋53/53決済完全一致

source commitの11ファイルをGit blob SHA-1と各RAW SHA256で取り出し、元sourceの経済関数を変えずに**相対import pathとNode JSON import assertionのみ**書き換える研究adapterを作成。Node24で `buildPenguDualLsV2EvaluationSeries` と `evaluatePenguDualLsV2PositionBar`、`createPenguShortV20State` がロード可能。

元SHORT 53自然候補を3期間で再生し、自然ENTRY候補数・entryTs/price、source STOP/EXIT reason/exitTs/exitPriceを全件一致。

| 原本の入口対象期間 | 元SHORT数 | raw pinned入口判定 | native EXIT完全一致 |
| --- | ---: | ---: | ---: |
| 2025-08-01〜2025-09-24（終端除外） | 6 | 6 | 6 |
| 2025-10-01〜2026-10-01（終端除外） | 40 | 40 | 40 |
| 2026-10-01〜2026-11-18（終端除外） | 7 | 7 | 7 |
| **合計** | **53** | **53** | **53** |

PREの候補期間を間違って2025-10-01まで延ばすと、9月25〜26日ごろの4件を過剰カウントする。該当時刻は**PRE評価期間終了後・基準BTのwarmup中**なので本来の自然SHORT候補ではない。9月24日をPRE入口終端とし、native STOPが9月24日以降に決済するケースだけ従来通り追跡することで、source全件一致。

`prism7_p8_real_native_parity.mjs` と `prism7_p8_native_lifecycle_core.mjs` は完全に別のコードパスから同じ53本の決済を再演し、同じ理由・価格・時刻になった。共有coreそのものが53/53一致。

## 2. P8人工相場：264H warmup +72H評価 =336H、384経路

事前固定 `PRISM7_P8_NATIVE_SOURCE_SYNTHETIC_INTEGRATION_CONTRACT_20261122.md`。4種類の歴史的取引印字有無mask（価格・損益はコピーしない）×8人工価格レジーム×12 seed =384。BTC/PENGU人工H1を各336本、M5から集計。source pinが要求するEMA168などを出すために264Hの連続warmup。自然SHORTだけの発火件数：**157**（384経路中290経路は0件）。エントリー件数を間引いて勝率を上げた結果ではない。

最初の72H評価終端時点では **86件決済、71件未決済（右打切り）**。決済済み86件のみの30bps勝率15/86=17.44%、平均-4.652%は、未決済の片側を無視していて**全157候補の正しい経済成績ではない**。この17.4%をPENGUの実力と誤解することは不可。

## 3. P8B：同じ157件の決済を72H追跡、元86件の出口も完全一致

事前固定 `PRISM7_P8B_PRECOMMITTED_72H_FOLLOWUP_NATIVE_CLOSEOUT_20261122.md`。評価窓に追加候補を足さず、元P8の自然SHORT **157/157件、入口時刻・価格等同一**、以前に完了した86件の元STOP/EXIT **86/86一致**。残り71件は追加72H内で閉じ、**決済157/157・打切り0**。

| ソースネイティブ価格モデル | 自然SHORT候補 | 全完了 | 勝ち | 勝率 | 平均取引損益率 | PF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10bps | 157 | 157 | 77 | **49.045%** | **+2.794764%** | **1.749635** |
| 30bps | 157 | 157 | 77 | **49.045%** | **+2.594764%** | **1.677470** |

これはsource純関数の**仮想価格モデル**。signed venue executionは0件。資金複利・他Runner Gross・資金調達・実発注/指値キュー・STOP gap fill・portfolio DDは未計算。利益がプラスでも「本番で投資する価値あり」とは判断しない。

### 新ENTRYの本質的な弱点（30bps仮想価格モデル）

| 人工価格レジーム | 自然SHORT発火 | 勝ち | 勝率 |
| --- | ---: | ---: | ---: |
| 下落継続 | 32 | 32 | 100.0% |
| 上昇継続 | 5 | 0 | 0.0% |
| レンジ | 25 | 13 | 52.0% |
| **下落→急反発（squeeze）** | **28** | **2** | **7.1%** |
| 上昇→急落 | 11 | 7 | 63.6% |
| 高ボラ往復 | 31 | 11 | 35.5% |
| 無印字の多い環境 | 22 | 12 | 54.5% |
| BTC/PENGU逆行 | 3 | 0 | 0.0% |

**急反発相場への誤SHORTの集中**が新しい反証である。これらのレジームは人工価格生成時に決めているため、実取引の市場でレジームラベルを事前に知ることは不可能。人工で悪いレジームだけ後から除くフィルタは先読み/過学習であり、不採用。

人工157件のEXIT内訳：HARD STOP 69、TRAILING STOP 30、MAX HOLD 47、DEADLINE 11。source価格モデルはResident STOP指定価格でのEXITを仮定するため、実相場の価格ジャンプや未印字による約定不能の損失を楽観視するリスクあり。

## 4. 価格・流動性の執行可能性と出所シーム

源dataの5m印字maskのうち20/384経路では、P8と同じ336Hを保持しつつ追加72Hの出所maskを伸ばすために**元アーカイブ終端で先頭への循環接続**を使用。実際の連続市場データではなく**人工的な継ぎ目**。20経路に属する自然15件は10勝/15、その他の364経路に属する142件は67勝/142（47.183%）。非wrap側でも80%には届かない。

全157件中、**入口対象H1に1本も正出来高M5がない10件**、H1の最初のM5に印字がなく時間内の後続M5から初めて観測された**59件**あり。計69件には source native H1 OPENで市場注文が約定したかを確認できない問題がある。無印字の足は架空の約定に変えず、全件に `venueSignedFill:false`, `actual_executable_fill_proven:false` を保存した。上の49.045%はこれらも含む**モデル勝率**であり実際のfillsの勝率とは別。

## 5. 検算と再実行契約

- 元source11 files immutable Git blobsの SHA-1 / RAW SHA256一致。
- 53/53 元候補+決済、別実装のnative coreと一致。
- P8 384経路・157自然候補・32 prefix因果検査PASS。
- P8Bは元157入口不変・元86出口不変・71打切り全解消・全157 native EXIT・32 prefix因果検査 PASS。
- Pythonの別個の回帰テスト **6/6 PASS**。
- P8B 408Hの全384経路を再実行し、summary/cases/pathsのSHA256完全一致：
  - summary `342b66fd551733b28d99ced3ff390ad0180c6c5b94592b4376d06e135a0446e0`
  - cases `e3d2eda65443241c67a2b2f931c086055814bd97d9965c2c9af045838579a11f`
  - paths `191a4eec179af7a86729307843eca0b299237af18ca9e8fde5ac338a767cf2e0`

実行方法：pin adapter作成後に `PRISM_NATIVE_WORK`, `PRISM_NATIVE_ROOT`, `PRISM_NATIVE_OUTPUT` で元53 parityを再実行。 `PRISM_NATIVE_SYNTH_OUTPUT` でP8 336Hを実行し、P8Bは追加で `PRISM_NATIVE_SYNTH_P8_ORIGINAL` にP8 case ledger JSONLを指定。Node 24 native TS loader `node --experimental-transform-types` のみ使用、パッケージインストールや現行master checkout変更は不要。

### 未達・次の論点

1. **SHORT V20の新規ENTRY/EXITを本番採用しない**。一律の方向閾値やgateで後出しに28件squeezeを除くのは不正な評価。
2. 元の157候補の**急反発28件（2勝26敗）のエントリー前のas-of相場構造／3h・6h下落余地／BTC先行性／時間順反転変化**を1件ずつ分解する。30bpsの勝率を80%にするには、候補157件を維持するなら126勝が必要で、**現在の77勝から49件の負けを実際に勝ちへ変える必要**がある（無理な相場ではショート自体を増やさない）。
3. 次の候補は**元native source全53件と別独立データ**で前向き因果検証し、synthetic generationも別の価格process familyで反証する。今回の384経路自体は観測済み研究セットであり再最適化はOOSにならない。
4. 引き続き実注文・Funding・source H1/M5不整合・Shared Risk/Gross・複利とproduction同値portfolio DD20%以内の検査が未完。

**PR #595のDraft研究ブランチのみにPush。master/本番VPS/Runner/建玉/STOP/実注文/Kill Switch/HYPE変更なし。**
