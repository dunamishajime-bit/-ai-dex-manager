# PRISM VII P33 — 採用候補を単独の良い結果から組み合わせ、SOURCEネイティブ出口・資本配分・実行遅延を一体検証（結果を見る前に固定）

P32により、SOURCE pinned native SHORT V20の純EXITを新S4構造ENTRYに接続すると従来REFERENCE_STOP72より平均参考netが落ちることを確認。P25/P28では「S4+REFERENCE_STOP72+1既知flash shock買戻し+0.75x」の限定的なM5 DD16.95%を得たが、遅延3本目ではDD20%超え。比較の違うreference STOPを混ぜずに、その「良い部分だけ合わせたら20%以下か」を直接検証する。

**元のsource SHA**：1657e173d250ad58f53e62f7bb0a3428fb405496。研究のみ、ユーザーが許可していない本番変更は行わない。データ2025-08-01〜2026-11-18のSOURCE PENGU/BTC 5M, H1、P32 pinned SOURCE純SHORT V20 EXIT適用済S4構造120候補（SOURCE original自然V20 53件29勝は別に保存）。P32 native V20 EXITの独立原稿・H1/M5 SHAを変更しない。

## 融合の事前固定
1. **入口Layer1**：P22 S4構造120全件、エントリー時刻・価格不変更。元V20が自然発火したと主張しない。
2. **出口**：P32の元固定source SHORT V20純状態 `createPenguShortV20State`＋`evaluatePenguDualLsV2PositionBar`に由来したnative参考EXIT（原ポジションphase、hard8%、trailing15/4%、期限・優先はP32のsourceイベント証跡）。従来の独立REFERENCE_STOP72は本試験の経済上のExitに使用しない。P32元NATIVE S4 all120個票と単一枠基準のM5 DDを正確に再現できなければFAIL。
3. **ショック検出Layer2**：SOURCE positive PENGU/BTCの**共通M5が完全に確定した時だけ**、P25既存閾値（source ENTRY比PENGU close <=75%、直前正印字PENGU close比<=80%、直前正印字BTC close比<=97%、PENGU takerBuy/volume<=45%、同時計BTC positive volume）を使用。SOURCE P32 native EXITまでに該当するかは**全新S4自然ENTRY候補120について再計算**。P25参考STOPの途中exit horizonで作った検出ラベルを無条件に借用せず、元SOURCE PENGU/BTC価格データから個票を因果再スキャンする。source不整合、zero volume、timestamp gapはFAILまたは不発と分類。検出後のbuyer-confirmation等未来の終値は信号当時には見られないので使わない。
4. **特殊shock EXIT**：検出後の次の正出来高PENGU M5 OPEN（第1、2、3本）を価格代理とし、SOURCE native出口時間が先または同じ時刻ならSOURCE原STOP/EXITを優先。positive M5がない場合はnative。買い戻しpriceにはSOURCE 30bps/10bps総費用と区別した **extraExitSlippage0/25/100/500/1000bps** を `open*(1+extra/10000)` で反映。これは板・ask気配やsigned fillを意味しない。
5. **単一slot**：全120構造setupを元P32 nativeのSOURCE entry proxy時刻順に再admit。EXITが早くなると元はOCCUPIEDだった取引が採用される可能性があるため、source P32が採用した候補だけを保持して「良く見せる」ことは禁止。元SOURCE P32の基準単一slotの結果/件数/満期/右打切りとunmodified 120、全参照非ショック条件に完全一致必須。cohort間で右打切りポジションがある場合は次cohortへの重複状態を元P32と同様に扱う。
6. **Layer3**：gross固定 `0.75x,1.0x,1.25x`（過去にユーザーが採用候補として明示）。JPY1万円のcash×gross per source entry、単独PENGU1slot、複利、feeはgross notional × （10 or 30bps）で一取引の往復総額相当。SOURCE M5 positive CLOSE markの口座最大DD＋**前の確定M5までのNAV peakに対する現M5 HIGH stress**を、元P26/P28の会計と数値一致させる。SOURCE P32 BASE/native gross1.0・extra0 については元P32のM5 DDと最終NAVと利益率/勝率の完全パリティ必須。
7. **グリッド固定**：3 gross×3 positive M5 delay×5 extra exit slip×2 fees = **90経済条件**、120構造原候補と建玉別全台帳（21付近×90≒1,980個票）の変化を保存。主条件 `gross0.75,delay2,extra0,fee30`、保守stress `delay3,extra1000,fee30`、sourceネイティブ基準 `gross1,shock OFF,fee30` を全報告。ショック元候補数・採用数・新単一枠救済/崩壊の取引数、次の正印字遅延、片道板費用、勝者の利益減少、SOURCE最大M5 markDD/prevpeak-highを表として明示。元参考STOP72との比較も独立コラムで保持。

## 採用基準
- SOURCE pinネイティブ53自然entry/exit、S4元120の母集団・entry/price、native STOPの経路とPRICE_PROXY、利益を伸ばす正しい勝ちを減らさないことは必須。
- **市場既知1件のP25ショックを観測後設計したEXITルールは、本試験でDD20以下になっても独立OOSの認定不可。** P29/P31では同一過去・未来違いで従来SOURCE勝ちSHORT利益を25〜30pp以上削る人工反例が存在。delay3/1000bps費用でも20以下か、P25では欠けるtrue venue ask/depth、Funding、他Runner Shared Gross、realized account DD、Shared日次損失7.5%、非発火・不利な人工相場について未確認。
- したがって研究でDD20以下なら**採用候補**、本番適用はBLOCKED。負けを知ってから「いいとこだけ残して」削除した取引/thresholdは禁止。
- 元Production master/VPS/Runner/建玉/STOP/注文/KillSwitch/他Codex worktree/HYPEには絶対変更しない。PR #595 Draft branchへsource/ledger/test/reportのみPush。
