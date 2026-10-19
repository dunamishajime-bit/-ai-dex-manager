# 8ロジック LONG/SHORT別・累積BT検証プロトコル（2026-10-19）

## 方法

一つのロジック・一つの方向・一つの損失要因を毎回個別に検証する。候補が統合口座のDDや負けの大きさを改善した場合のみ、その候補を研究採用リストに追加。次の候補は前段の採用済みリストを必ず含む累積構成でBTを再実行する。最終的に実装へ移す前にも、累積完成構成の正式統合BT・venue STOP認証・Shared Risk・Margin Guard・Pending予約・CIを行う。

**改修焦点**
- 利益反落：確定5分足の有利終値とピーク後の戻りでresident STOP相当の出口を再生。既存Q102、HYPE、Idle STOPや追走との二重取りをしない。足確定より前に利益確保STOPを有効化しない。
- 初期逆行：有利方向への継続が乏しいまま逆行する候補に、通常のEXITより早いrisk STOPを再生。そもそも少し逆行してから勝つ原本勝ち取引の逸失を集計する。
- 初回の研究候補はV12 SHORT 4通り、次はHYPE LONG 2通り。ほかの方向へ一律転用しない。

## 凍結基準

2026年10月17日最新確認済みの8ロジック統合構成、2025/08/10〜2026/08/10、初期1万円・積立無し・複利。V12 V4、Q102 5m有利+2%後+0.5%保護、HYPE2%損失STOP、Idle DOT/RENDER0.25xと5mトレールを含む。PENGUは従来出口維持。

- 10bps: 最終資産222,818,966.8780円 / 最大H1 MTM DD -15.6206368129% / PF3.458796 / 1,310件
- 30bps: 最終資産124,289,206.8183円 / 最大H1 MTM DD -16.7877687749% / 1,307件
- 元データは8ロジックfrozen research sourceとBinanceVision過去5mをAsterのエントリー価格へ正規化したモデル。実Asterの板価格・signed resident STOP再現ではなくLIVE証明にも使用しない。
- 旧40億円/1,358件（2026-10-05）BTは比較基準から除外。

## 1,310件の5分足診断

5m原本の照合可能分1,271件。V52株式等の39件はデータ未照合、除外。
- V12 SHORT 199敗、そのうち88件は5m終値ベースで有利+1%以上から負け。43件は有利0.25%にも未到達。
- HYPE LONG 23敗、そのうち4件は有利+2%以上後負け、9件は少量の有利推移後負け、10件は有利0.25%未到達。
- Q102 SHORT 32敗、うち13件は有利+1%以上後負け。
- RESIDUAL LONG 14敗、うち6件は有利0.25%未到達。
- Q102 LONG 11敗、うち3件は有利+1%以上後負け。
- PENGU LONG 12敗、うち8件は有利+1%以上後負け。ただしPENGUの既存EXITは従来通り一時固定して監査先行。
- V52の株式銘柄はYahooFinanceとの照合を先に行う。

## 方向別スコープ（暫定順）

1 V12 SHORT
2 HYPE LONG
3 Q102 SHORT
4 RESIDUAL LONG
5 Q102 LONG
6 V12 LONG
7 IDLE SHORT（ATR2.5／20%残余数量案は研究Push済みだが最新8ロジックへの統合認証は未達）
8 PENGU LONG
9 PENGU SHORT
10 V52 SHORT
11 V52 LONG
12 FET LONG

HYPE SHORT、RESIDUAL SHORT、IDLE LONG、FET SHORTはこの基準の受理トレードに存在しない。新しい方向のロジックは作らない。順位は時系列DD寄与の確認で変更し得る。

## 累積採否ルール

候補は前段に採用された変更を全部含む状態で10bpsと30bpsを両方再実行。成功記録には、前段SHA/適用済み候補ID、対象シンボル・方向・出口、因果5m時刻、コスト別DD・最終資産・PF・全トレード数、原本勝ち減少、負け最大・損失総額、変更される注文・他Runner競合を記録。

10・30bps両方で最大DDが改善した場合は研究採用。DDが実質横ばいで負け1件/負け合計が確実に改善する場合は追加条件付き研究候補。DDが悪化した候補は、利益が増えても原則見送り。いずれも2026年5月以降の時系列・独立シグナルで再現性が弱ければShadow止まり。

この段階での研究採用は**実装・LIVE切替の許可ではない**。取引所署名付STOP readback、部分約定、STOP競合、5mの正規化元の検証、per-Runner owner-lock、pending、最小数量、SharedRiskの正式認証が必要。

## 再現コード

- research/long_two_axis_latest_full8_20261019.py
- research/long_short_latest_m5_loss_classification_20261019.py
- research/long_short_sequential_full8_bt_20261019.py

研究結果は docs/research/results/long-loss-research-20261019/SEQUENTIAL_FULL8_ACCEPTED_CHAIN_20261019.json と、各候補の個別10/30bps JSONに保存する。元のGit repo、VPS、LIVEを一切変更しない。
