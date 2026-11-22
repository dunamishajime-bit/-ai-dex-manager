# PRISM VII P34 — gross0.75固定・120候補不変・SELLER_PULLBACK_REJECTIONの入口誤判定分解（結果算出前の固定仕様）

**対象はP33で事前登録した研究 `PENGU_S4_HYBRID_P33`**。ユーザー指示に従い**全条件 gross0.75倍だけ**を維持し、レバを下げてDDを隠さない。P33の新S4構造120 setup/source P32 native pure EXIT/Source P25 shock再スキャンとM5単一slotをそのまま使用。元SHA `1657e173d250ad58f53e62f7bb0a3428fb405496`、53/53自然V20 pure entry/EXIT検証を保持。

## 研究対象と凍結
P33のnative V20 exit+S4 entry選定済21決済15勝と参照。PRE 0/1、BASE12/15、POST3/5。新S4 `SELLER_PULLBACK_REJECTION` は10決済6勝、`BREAKDOWN_RETEST_FAILURE` 11決済9勝。P33急落時間早利確を除いた元native EXITも比較。過去時点の勝敗を予測変数にして優良トレードだけ残すのは禁止。

**Layer1 P20 source causal H1 asofFeatures**の下記固定フィールドを読み込む：
- `BTCret6`（直近6時間BTCリターン）: BTC trend >0ならSELLERのSHORT逆方向リスク、閾値 **<=0**（正負で自然に区切る）。
- `PENGUminusBTC6`（直近6時間のPENGU-BTC相対リターン）: SELLERの戻り局面で既に強く先行している通貨をSHORTしない仮説、閾値 **<=0**。
- `EMA24, EMA72`: PENGU長め趋势確認 `EMA24<=EMA72` ならSHORT下方レジーム。
すべて **元のsignalReferenceTs時点で確定済み**のP20 `asofFeatures`、P32 native M5 ENTRYより前（対象コイン相場H1自身の先読みなし）を採用。入力 null/NaN/corruptは新エントリー不可。原120全件のIDとroute, cohort, status等は原本を保持。

##事前固定の実験（結果を見て追加閾値禁止）
試す構造は全部で五つ：`BASE_UNMODIFIED`、`SELLER_BTC_TREND_ONLY`（BTCret6<=0）、`SELLER_REL_WEAKNESS_ONLY`（PENGUminusBTC6<=0）、`SELLER_EMA_TREND_ONLY`（EMA24<=EMA72）、`SELLER_CONSENSUS_3_OF_3`（上の三つALL TRUE）。**B/relative Weaknessのルート条件は既存どおり固定**し、`SELLER_PULLBACK_REJECTION`にだけ入口ゲートを適用する。

再評価時は、原P32 candidate entry時刻は守り、候補落選を `RESEARCH_P34_GATE_BLOCKED` と記録して、元source120/setupを全て残す。**時系列で全120について単一slotを再admitし、入れ替わって新たに出る候補も取引として計上**（脱落した既知loserだけを消して分母を減らす行為禁止）。P33 shock detectorは全候補SOURCE native出口までの因果信号を入力（source価格とBTC閾値等は固定）し、gate後に元slotから再admit。源pure EXIT優先、後続正出来高OPENを買戻し価格proxy。

**全てgross0.75固定**、全モデルでfee30bps、P25検出後のpositiveM5 OPENを2本目と3本目、extra slippage0bpsと1000bpsの 5仮説×4執行stress = **20 scenarios**、各SOURCE120候補を母数に持つledgerを出す。さらに `SHOCK_OFF / gross0.75 / fee30bps` 5モデルも同じく比較（計25）。結果の推定勝率、平均損益、PF、取引数、取りこぼした勝者/除外された敗者、source M5-close mark DD・前の確定M5 high stress DDを表示。**削除した勝ちのPnl合計と保持した元の負けPnl合計**の対を必ず記録し、「勝率だけの改善」を退ける。

## 採用判定と反証
- Gross0.75、30bps、「第2print 追加滑り0」のP33基準 **DD17.03139963%、21決済中15勝、PF4.5071145**に完全一致できなければ全体FAIL。
- 3本目positiveM5 OPEN/extra0ではP33元基準DD20.4662988%、同extra1000bpsでは23.87133174%。**20未満になる可能性のある条件でも、源勝者を失う・PFが下がる・POSTの勝ち/負けに改善しない・実行stressで崩れるなら不採用。**
- PRE/BASE/POSTの分離。POSTの勝率はP33/P22で既に参照された「非完全blind」検証であることを明記。条件を再調整してPOSTへ合わせない。小標本の勝率が80%超でも80%が真の確率だとは主張しない。
- 価格代理では5分足同士の順序が厳密でなく、SOURCE V20原本ENTRYとS4新ENTRYの同一性は不成立。P25ショックthreshold自体も2025-10 flash観測から導出済み。板数量/滑り/Funding/Shared全Runner DD、MAXDD20の本番整合、Owner/CI実承認を観測していない。
- LIVE採用は`BLOCKED`、Codexと競合せず研究ディレクトリ+PR #595 Draftのみ改変。Production/master/VPS/実注文/建玉/STOP/KillSwitch/HYPEに一切変更なし。
