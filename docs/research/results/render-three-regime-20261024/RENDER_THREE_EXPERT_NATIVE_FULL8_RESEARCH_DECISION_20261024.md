# RENDER 3系統追加の8ロジック・共通口座統合バックテスト（2026-10-24）

**STATUS: RESEARCH_ONLY_EIGHT_LOGIC_NATIVE_H1_VERIFIED_10_30BPS / 正式採用なし / Production・VPS・HP・注文変更なし**

## 目的と比較条件

- 全体期間：2025-08-10〜2026-08-10。8ロジック（V12 / PENGU / Q102 / FET / HYPE_LONG / V52 / IDLE / RESIDUAL）、**初期資金1万円、毎月追加0円**・共有Gross・同一銘柄優先権・クールダウンを**既存の凍結H1 Native共通口座エンジン**で再計算。
- 既存RENDER SHORT（IDLE、利益保護+1.5%到達後+0.35%床）の入口・出口を維持し、他7戦略の入口・出口・Gross・優先権は固定。新2ルートはIDLE配下、1件requestedGross0.25x。
- 追加ルートA「BTC上昇失敗SHORT」、追加ルートB「反発失敗後のOI3時間減少SHORT」、従来ルートCの**3系統候補で共有資金により動的採択**。新規ルート出口はTP+4%／初期STOP−3%／保有上限24h、M5の次足始値・stop-firstによる確定候補価格。Costは10bps/30bpsをNative財布で別再計算。取引決済後の既存同銘柄クールダウン・account/shared ownership・発注枠はnativeに任せ、迂回しない。
- Native純粋基準：`RENDER_TWO_REGIME_PARITY_BASELINE`、研究枝`research/render-dual-native8-handoff-20261024`より復元。新ケースのみ別candidate注入。単独BTの損益合計ではない。

## データ制限・Fail Closed

重要な事実：Native共有財布が使用するAster正本参照の`normalized/aster/klines/RENDERUSDT.jsonl` H1評価足は **2026-01-06 13:00 UTC**からしか存在しない。新入口を2025-08から通すと`UNVERIFIED_ACTIVE_POSITION_MARK:RENDERUSDT:1755219600000`を検知して本来のFail Closedが作動。**この安全確認は解除していない。**

そのため新ルートは2026-01-08〜2026-08-09の評価価格の存在する期間だけ発火を許可し、従来の7戦略と既存RENDERを含む口座全体は2025-08-10から引き続き再計算。2025-08〜2026-01-07の新入口の仮想約定と損益は**含まれない**。旧RNDR/新RENDERの2024年跨ぎは研究だけであり、Nativeの評価価格が足りない期間をBinance価格で代用・補間していない。

## Native共有資金BT：10bps・30bps

| 指標 | 既存8 | OI<=-0.6% + A | OI<=-0.2% + A |
|---|---:|---:|---:|
| **10bps最終資産 円** | 284,418,781 | 287,970,658 | **288,120,930** |
| 10bps 基準比資産 円 | — | +3,551,878 | **+3,702,149** |
| 10bps PF | 4.72763 | 4.73206 | **4.73366** |
| 10bps 最大MTM DD | -14.51499% | -14.51499% | -14.51499% |
| 10bps 全8取引数 | 1,285 | 1,290 | **1,291** |
| 10bps 新ルート採択数 | — | 8 | **9** |
| **30bps最終資産 円** | 173,611,665 | 173,918,916 | **173,946,439** |
| 30bps 基準比資産 円 | — | +307,250 | **+334,774** |
| 30bps PF | **3.83997** | 3.82384 | 3.82412 |
| 30bps 最大MTM DD | -15.01472% | -15.01472% | -15.01472% |
| 30bps 全8取引数 | 1,284 | 1,289 | **1,290** |
| 30bps 新ルート採択数 | — | 7 | **8** |

- OI−0.2%の内訳：10bps新採択は2024年BTC失敗型6件、OI反発失敗型3件。30bpsは6件・2件。口座総件数増加が採択新ルート件数より少ない理由：既存IDLEの競合3件（10bps、30bpsでは2件）とV12の1件が代替されるため。**これはGross/所有権/優先権競合を含む動的再選択の効果**。
- OI−0.6%の内訳：10bpsの6+2件、30bpsの6+1件。候補を全て強制発火させていない。
- 全ケース・コストで`accounting=PASS`。Native 3反復の**経済取引行**は一致。生ファイルSHAは一部caseで通し番号`candidate_id`だけが変化するため不一致だが、候補番号を除く全フィールドと決済内容・経済価値は完全一致した。
- 10bpsではPFも僅かに改善。30bpsではPFが逆に低下。**最大DDはいずれも全く改善せず**。採択取引数は両Cost+5（OI−0.6%）ないし+6（OI−0.2%）。
- 30bpsの資産改善33万円規模は元の資産1.736億円に対して約0.19%で小さい。閾値間の差は約2.75万円しかない。研究内の過去最適化に過剰な確信を持たない。

## 根拠・リスク・次の段階

- 新候補の入口・出口は、Binance公開資料でSH256照合した確定5分足・公開遅延付きOI/成行売買履歴に基づく**価格モデル**。Aster会場L2板・部分約定・スリッページ・Funding cashflow・保護STOP再発注・再起動復旧の同等性は未認証。
- 新ルート作成時の`funding_return_per_gross=0`は研究前提であり、別venueの正確なFunding台帳一致は未達。JPY口座成績はnative replayerのモデル値であり運用勘定ではない。
- 既存Native保護停止・共有アカウントlock・所有権制限を緩和せずに計算し、全8戦略の期待注文候補と同時評価したが、2025年の新ルート発火を含む完全な1年分の統合効果は未検証。
- 2026-08〜2026-10の独立単独研究初見再検証はOI−0.6%で10件/30bps PF1.6818、OI−0.2%で13件/30bps PF1.1534。**Native共通口座の2026-08以降前向き・実資金同条件証明ではない**。
- 本研究だけなら**OI−0.2%が10/30bps両方のJPY最終資産・件数で僅差優位**。対してOI−0.6%は後続単独検証のPFが高い。どちらもDD低下を実証できず、採用・LIVE化は見送り。
- 次の必須検証は、2025年分RENDER H1 venue正本取得と、その署名なしのBinance代替を正本と混同しない独立認証、Funding/部分約定/保護注文/共有Riskのparity、同一エンジンでの全期間10/30bps再計算、真正なForward Shadowで再現性確認。上記未解決のままGross優先・STOP・kill switchを解除しない。

## 再現可能な一次証拠

- `scripts/dd-reduction/run-render-2024-triple-native-full8-20261024.py`
- `scripts/dd-reduction/audit-render-three-expert-native-full8-20261024.py`
- `docs/research/results/render-three-regime-20261024/RENDER_THREE_EXPERT_TRUE_NATIVE8_10_30BPS_COMPARISON_20261024.json`

出力フル会計Ledgerは研究専用PCの`C:/tmp/render-triple-native8-mark-h1-jan2026-20261024`に配置。VPS/Production/HP実資金口座には一切変更を行っていない。
