# PRISM VII P35 — S4入口のBTCトレンドGateを元自然V20 53トレードで反証（0.75固定）

本ドキュメントは結果を見る前にPR #595 Draftへ保存する。元固定V20 SOURCE `1657e173d250ad58f53e62f7bb0a3428fb405496` の原53 native signal/EXIT、30bpsに対して53/53 EXACT、29win/53はSOURCE pinで確認済み。P34のS4 SELLERルート向けBTC6h<=0追加条件が真の市場構造フィルターなのか、既に観測したS4 21決済（15win）に過適合しただけかを検討する「異なるエントリーロジックへの**負の対照（shadow transfer）**」。元53の入口と出口・fee・価格を絶対に再演算/変更しない。

## 事前固定の因果入力と判定
自然V20原53 entryTsより**1時間前の完了BTC H1**を使い、`BTCret6 = BTC_H1_close(signalReferenceTs)/BTC_H1_close(signalReferenceTs - 6h)-1` を算出。BTC/PENGU H1 raw archive 2025-08〜2026-11-18、開始6Hが欠ける場合はshadow判定`INELIGIBLE_NO_DATA`（元取引は元53に必ず残す）。PENGU比較は同時点PENGU ret6 - BTC ret6。「SOURCE元53のnative V20 SIGNAL自身の反復発火は除外不可」という事実は厳守し、BTC shadow =**別の研究用仮判定**。
比較モデル固定：
1. `NATIVE53_UNMODIFIED` — 53原取引、native EXIT原データ、30bps、1回の口座を 0.75x 配分とした倍率スケール（overlappingの場合はポートフォリオDDとして解釈禁止）。
2. `NATIVE53_SHADOW_BTC6H_NONPOSITIVE` — BTCret6<=0。
3. `NATIVE53_SHADOW_PENGU_REL_WEAK6H` — PENGUret6<=BTCret6。
4. `NATIVE53_SHADOW_BOTH` — 両条件成立。

評価は毎回母数53を固定し、各shadowの勝者/敗者を保持・失う件数（SOURCE native .75倍30bps PnL）、総元勝者利益消失と元敗者損失回避、元pure native winrate / PF、原gross0.75 account per-trade returns を報告。元53自然ENTRY/EXIT間の同時建玉数を計算し、 overlappingあれば単一PENGU slot/複利DDを計算・主張しない。S4 120別データと同一母数扱い不可。SOURCE original53本来の1x source PNLと0.75投資額の口座単位を混同しない。PRE/BASE/POSTを元時系列時刻で固定し、各段のwinsの異質性を明示。

## 判定
元53へ同じBTC gateを移すことは**事前に採用予定なし**。自然V20元55? ではなく53件29勝を、未来に知っている損益で抽出して評価するのは禁止。シャドーシグナルで勝者を失う/分割で安定しないなら、S4 P34のBTC gateの普遍性が弱いことを記録する。
このSOURCE original53は既存過去データで、真正 OOSではない。一定の利益を示してもLIVEへの根拠にはならない。現在P34ではS4 BTC6hゲートにより単一21->19件、15->14win、shock ON0.75x delayed3 extra1000bps MarkDD23.8713->18.8177%だが、P25 2025Oct shockの事後仮説・SOURCE実板・他Runner/Shared riskは未検証のまま。
作業はOwner PC独立研究フォルダとGitHub PR #595 Draft研究のみ。Production/master/VPS/Runner/STOP/建玉/KillSwitch/注文/Codexに変更しない。
