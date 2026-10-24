# RENDER 2024〜2026利益再設計・Native8最終研究判定（2026-10-24）

STATUS: **RESEARCH_CANDIDATE_4427_NATIVE8_10_30BPS_ECONOMICS_PASS_NOT_ADOPTED**

## 要旨

ユーザーの目標：過去BTで30bps控除後の利益が安定して取れない入口は未来も運用しない。取引回数をできるだけ減らさず勝率・PF・最終資産を改善し、最大DDを悪化させない。勝率目標約70%。

RENDERの初期入口BTC上昇失敗SHORT（旧2024年49件・勝率51.02%・PF1.05）と、OI−0.2%反発失敗SHORT（2024年20件・勝率65%・PF2.08）の構造を分析。データはBinance Visionの公開公式M5/RNDR・RENDER、確定H1、公開OI・BTCの過去データを使い、2024-01-01〜2026-08-09と2026-08-10〜10-22を分けて検証。

### 研究した候補の規模と除外理由

- BTC/OIの独立した7×7出口＝49例。2024年WR72.857%・N70まで改善するが、2025年後半がPF0.6912で赤字。
- 相場特徴による1D出口切替5,184例。2025年後半をPF1.3176まで改善する候補あり。しかし2026年8〜10月の再検証でPF0.7757・損益率合計−2.9064%に悪化、**不採用**。
- 4種類のOI閾値×7×7出口＝196例。年別PF、年別WR、2025年各期間PF、取引数の同時条件を満たすもの0例。
- 6 SHORT familyの優先順位・代替/追加・7出口＝722例。厳密同時条件を満たすもの0例。特に2025年H2のB OI型が負け5件×−3.8%で阻害要因。
- Bの初期STOP1.5/2/2.5/3/3.5%×6出口（計30出口）と6入口の優先順位、A既存トレーリング出口を組み合わせ＝4,440例。3年毎のWR67%+、PF1.15+、発火数維持、2025年各期間黒字、各年DD20%内を同時に満たしたもの0例。
- 従って**勝率70%かつ強い各区間収益の完成形は未発見**。インサンプル最大値を選ぶことを明示的に禁止する。

### 各年度・30bps黒字を維持した暫定候補 #4427

事前優先順位：
1. `SHORT_2024_BTC_RALLY_FAILURE`（A）
2. `SHORT_DEEP_DROP_FAILED_RETEST`（X）
3. `SHORT_BEAR_REBOUND_2H_FADE`（B; OI3h<=−0.2%）

A/Bは共通で次のSHORT出口：TP +5%、初期損失STOP −3.5%、最大保有24時間、保有中+2.5%の最大含み益到達後は建値から+1.0%を利益保護。XはTP+1.5%、STOP−2%、最大6時間。最大12時間の同一契約クールダウン。

A/Bトレーリング出口は既存7モデル `TRAIL_MFE25_FLOOR10_H24` と同一。今回テストした `BST35_T50M25H24` もパラメータ一致。つまり**#4427を「30種類の新STOPの発明による改善」と誤記しない**。

| 30bps | 取引数 | 勝率 | PF | 決済ベースDD |
|---|---:|---:|---:|---:|
| 2024年 | 70 | 65.714% | 1.1579 | −13.152% |
| 2025年 | 64 | 60.938% | 1.4868 | −16.422% |
| 2026年1〜8月 | 41 | 78.049% | 2.4013 | −8.376% |
| 2026年8〜10月（先行研究で一度見た再検証期間） | 13 | 69.231% | 1.1998 | −7.456% |
| 2025年8〜12月（上の2025年に含む） | 19 | 52.632% | 1.1310 | −14.521% |

2024年1〜5月はPF1.0351だが複利ベース−0.182%、完全な全区間黒字ではない。2025年後半は勝率52.63%、PF1.131と余裕が薄い。2026年8〜10月はすでに先行研究で使用した再検証期間であり、未使用OOSではない。

### Native8全口座BT（2025-08-10〜2026-08-10、初期1万円、月入金なし）

既存8エンジンV12/PENGU/Q102/FET/HYPE_LONG/V52/IDLE/RESIDUALのNative H1モデルに#4427の追加候補をIDLE Gross0.25xとして追加。候補側Binance M5 modeled entry/exit、engine側のAster RENDER H1 markは2026-01-06以降だけのため、**追加のRENDER新ルートを2026-01-08〜2026-08-09に限定**。2025年の新入口を捏造補完しない。口座ロック・Gross・他ロジック・既存ランナーは変更せずNative8で候補選択。

| Native8 | 10bps baseline | 10bps + #4427 | 30bps baseline | 30bps + #4427 |
|---|---:|---:|---:|---:|
| 最終資産JPY | 284,418,780.727 | **288,587,378.771** | 173,611,665.163 | **174,459,200.220** |
| 増益JPY | – | **+4,168,598.043** | – | **+847,535.057** |
| Portfolio PF | 4.727629 | **4.740434** | **3.839967** | 3.825951 |
| 最大MTM DD | −14.514985% | **同じ** | −15.014724% | **同じ** |
| 決済件数 | 1,285 | **1,291** | 1,284 | **1,290** |
| 追加RENDER選択数 | – | **9件**（A6、B3） | – | **8件**（A6、B2） |

三重全再実行の経済台帳で `candidate_id` の任意採番を除いたSHA一致：10bps/30bpsとも**PASS**、accounting PASS、8ロジック継続、max accepted gross<0.25x。raw byte SHA完全一致ではない（候補ID採番差分）。元IDLEルートは10bpsで3件、30bpsで2件が競合で選ばれず、全体の取引数は両コストで+6件。**X（深押し失敗リテスト）は新ルート候補2件ともNative8では競合などで不採用・実選択0件**。従って増益の実証はA/Bによるもので、Xの本番価値は未立証。

Native8のWR＝10bps 73.044%、30bps 70.233%。これは**8ロジック合算の勝率であり、RENDER専用の勝率70%ではない**。Native 30bps PFは0.014016低下した一方、最終資産・回数増・DD同等。現行Native baselineと比較であり、2026年のVPS最新LIVEの完全再現ではない。

### 結論と境界条件

1. **研究段階の「利益第一候補」は#4427**。3年の年次と2026Aug-Octで30bpsPF>1、2025H2もPF1.1310、Native8で10/30bps最終資産増・DD不変・件数増を確認。失敗候補ではなく**最有力研究候補として保存**。
2. **正式採用・LIVE切替の根拠はまだ不足**。RENDER個別2025年勝率60.94%・2025H2勝率52.63%。2024Jan-May 複利リターン−0.182%。期待値が弱い期間が残る。4,440例を含む大量試行の選択バイアスと再検証期間の汚染、Native8の2025年新入口に必要なAster M1/H1 mark欠損、実取引所の約定証拠・Funding一致未確立が残る。
3. **追加実装・VPS・Production・HP・LIVE・発注は行っていない**。研究スクリプト/比較台帳と因果元ソースだけGitHubへコミットする。

## 研究正本

- `scripts/dd-reduction/render-all-short-regime-m5-entry-bank-20261024.py`
- `scripts/dd-reduction/render-six-short-entry-portfolio-priority-grid-20261024.py`
- `scripts/dd-reduction/render-2024-2026-short-B-30-bracket-models-20261024.py`
- `scripts/dd-reduction/render-B-brackets-six-family-all-combo-screen-20261024.py`
- `scripts/dd-reduction/render-six-short-postaug2026-retrospective-bank-20261024.py`
- `scripts/dd-reduction/render-B-stops-seven-shortlist-postaug-retrospective-20261024.py`
- `scripts/dd-reduction/run-render-4427-native8-shared-wallet-20261024.py`
- `scripts/dd-reduction/audit-render-4427-native8-20261024.py`
- `docs/research/results/render-three-regime-20261024/RENDER_4427_RESEARCH_NATIVE8_10_30BPS_COMPARISON_20261024.json`
- `docs/research/results/render-three-regime-20261024/RENDER_2026AUG_OCT_7_CANDIDATE_B_STOP_RECHECK_20261024.json`
