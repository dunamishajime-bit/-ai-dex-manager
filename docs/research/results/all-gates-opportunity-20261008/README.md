# 全ロジック Gate／取引機会の再検証（2026-10-08）
対象は「昨日」2026-10-07 JSTの24時間。UTCでは2026-10-06 15:00以上、2026-10-07 15:00未満。

## 結論
昨日の全体無発火を「BTC Gateが厳しすぎる」とまとめる根拠はない。BTC条件を緩めるだけでは、V12・PENGU・Idle DOTの昨日の候補数は増えなかった。一方、Idleには既存条件を通過した候補があり、発注数量丸めによる1x未達判定で止まった事実がある。取引機会を回収する優先対象はこの実行判定とBaseline状態の時刻整合性である。

LIVEのパラメータ／注文ロジックは今回変更していない。以下は監査と比較研究の結果であり、全体利益・DD改善が認証されたGate変更ではない。

## 全ロジックの判定
| ロジック | 昨日の確認 | 再判定・次の対応 |
|---|---|---|
| V12 | 現行0候補。BTC閾値2%→1.5%・1%・0%でも0。Score、出来高、ATRの単独緩和および限定併用も0 | NEUTRALを禁止する設計ではなくScore等で許可。BTCの一括緩和を採用する根拠なし。ExitのLIVE／参考BT差異を先に解消 |
| PENGU | 24個の独立時刻すべてでSHORT用BTC条件通過。現行・8緩和案とも昨日0候補 | 基本セットアップ不成立。BTC緩和よりM05 Forward Shadow継続 |
| Q102 | REV LONGの14日リターン24%以上条件で3回停止。条件撤去ではFET LONGが10:00・18:00・22:00 JSTに提示 | BTC Gateではない。撤去は単体比較で勝率/PF悪化。20%への軽い緩和でも昨日候補は増えず。HIGH_VOL SHORT 0.60xは維持 |
| FET BRK48 | 基本Breakout不成立。出来高・72hリターン・時刻Gridの緩和も昨日0候補 | 方向BTC Gateなし。入口の一括緩和よりExit研究を優先 |
| HYPE trend H1 | 現行およびSlope・Breakout・EMA距離緩和でも昨日0候補 | 稼働ルートに方向BTC Gateなし。旧sidecarのBTC条件と混同しない |
| Idle SHORT／Residual LONG | 信号のみ再生で7／10候補時刻。ただし実注文可能数ではない。JUP SHORTとAVAX LONGが数量丸めで停止 | 数量判定、Baseline時刻整合、Margin Guard状態を分離して修正・検証 |
| V52 | 市場閉鎖、Basis/Net Edge不足、Reference stale等 | 方向BTC Gateなし。参照価格の鮮度と営業時間が支配的 |

## 実行Gateの具体的な問題
Idle SHORTおよびResidual LONGは、数量を取引所lot stepで切り下げた後、notional/equity < 1-1e-6なら停止する。許容される1x不足はわずか0.0001%であり、通常の数量切り下げでも超え得る。
ソースはlib/idle-priority-short-runner.tsとlib/idle-residual-long-runner.ts。昨日の該当ログは41回で、同じ候補の再試行を含むため41トレードとは数えない。strategy・symbol・UTC時間でまとめた6群をvalidated-audit.jsonに保存。

修正設計は「不足を任意の割合で許す」ではなく、要求数量に対する正しいlot step切り下げを確認し、実notionalでGrossと予約を整合させること。min notional、capacity、quote freshness、margin確認は維持する。この変更は次の実装修正対象であり、今回の監査では未適用。

Baseline timestamp staleの保持も多数ある。V12の2H判定とIdleのH1判定／短い鮮度要求が関係する可能性があるが、昨日の各時点の全Baseline snapshotは保存されておらず、原因を一律に確定できない。単純に鮮度上限を緩めず、as-of時点の判定証明と更新周期を合わせる必要がある。lock busy、rate budget、Margin Guard不健全も独立原因であり、無効化しない。

## 単体比較で見えたこと
PENGU BTC EMA168距離下限 -4%→-6%は年間候補113→115、単体勝率74.63%→73.53%、PF4.073→3.745。RecoveryのBTC6h最低値を0へ緩めると候補123となるが勝率72.06%、PF3.528。いずれも昨日は0のまま。
Q102 REV LONG条件撤去はS34候補267→301、昨日3候補を追加。ただし単体勝率64.18%→60.40%、PF2.423→1.932。後半でもPF2.025→1.587。候補を増やすための即採用は支持しない。
Idle DOTのBTC24h上限0%→+1%は候補694→709だが昨日7のまま。単体PF1.186→1.073。BTC緩和を優先する根拠は弱い。

## V12参考BTとの実行差異
LIVEは新Trailing Stopがすでに現在価格を越えた場合、現在quoteで即時Exitする。既存の参考候補台帳では、該当状況に新Stop価格でExitした例がある。
例：ADA LONG、entry_ts_ms=1754798400000、entry=0.8216。完成2Hで更新したStopを越えた次H1 openの代理quoteは0.8137（約-0.962%）。既存台帳のExitは0.8314967741935484（約+1.205%）。
H1 openは実際のbid/askを復元するものではないが、Stop価格での有利な約定を仮定できないことは確認できる。V12の比較損益、従来の全体複利損益・DDはこの差を解消した再計算が必要。今回の単体DDを現行全体DDとして扱わない。

## 方法と限界
現在ソースのpure signal/configを直接読み、年間H1データと昨日の公開H1を時間順に再判定。年次データは2025-08-10〜2026-08-10、銘柄ごとの欠損・開始時期は異なる。昨日用は追加公開データと稼働保存データを使用。年間と昨日は連続した同一検証期間ではない。
年間候補は時刻ごとに提示されたsignal数であり、独立実約定数ではない。単体損益はH1モデル・1トレードの総コスト10/20/30bps控除を使う参考比較で、funding、実スプレッド、全体Gross制約、他ロジック優先、Idle admission/preemption、V12の完全なrotationを再現しない。Q102再生成はS34系でありHIGH_VOL全件の学習・選択競合を再生成していない。V52はLIVE診断監査でありこの38ケースの価格BT対象外。
serial_realized_ddは単体の決済順unit equityであり、全体の含み損込みDDとは異なる。以下の勝率/PFも実運用期待値やGate採用証明ではない。特にV12は上記Exit差があるため機会数の参考に限定する。
全38ケース、114コスト集計を再実行し、保存tradeから勝率・PF・平均損益を独立再計算して一致を検証。昨日candidateとjournalの時間範囲も確認。

## 全38ケース（10bps参考）
| Logic | Variant | 年間提示候補 | 昨日提示候補 | 単体trade | 単体勝率 | 単体PF |
|---|---|---:|---:|---:|---:|---:|
| FET | BASELINE | 21 | 0 | 12 | 66.67% | 2.793 |
| FET | GRID_1H | 77 | 0 | 23 | 34.78% | 0.781 |
| FET | RETURN72_0 | 23 | 0 | 14 | 57.14% | 1.889 |
| FET | VOLUME_10 | 22 | 0 | 12 | 66.67% | 2.731 |
| HYPE | BASELINE | 60 | 0 | 26 | 42.31% | 1.218 |
| HYPE | BREAKOUT_0 | 87 | 0 | 31 | 35.48% | 1.099 |
| HYPE | DISTANCE_1200 | 71 | 0 | 26 | 42.31% | 1.185 |
| HYPE | SLOPE_50 | 67 | 0 | 27 | 44.44% | 1.332 |
| IDLE | BASELINE | 694 | 7 | 146 | 54.11% | 1.186 |
| IDLE | DOT_BTC_01 | 709 | 7 | 148 | 50.68% | 1.073 |
| IDLE | RELATIVE_02 | 833 | 9 | 160 | 53.12% | 1.095 |
| IDLE | VOLUME_80PCT | 765 | 8 | 149 | 53.02% | 1.193 |
| PENGU | BASELINE | 113 | 0 | 67 | 74.63% | 4.073 |
| PENGU | BTC_DIST_M06 | 115 | 0 | 68 | 73.53% | 3.745 |
| PENGU | BTC_MAX_06 | 113 | 0 | 67 | 74.63% | 4.073 |
| PENGU | IMPULSE_M05 | 140 | 0 | 68 | 73.53% | 3.478 |
| PENGU | LONG_BTC_M01 | 113 | 0 | 67 | 74.63% | 4.073 |
| PENGU | RECOVERY_BTC_0 | 123 | 0 | 68 | 72.06% | 3.528 |
| PENGU | RSI25_VOL7 | 118 | 0 | 67 | 73.13% | 3.628 |
| PENGU | SHORT_RSI25 | 115 | 0 | 67 | 73.13% | 3.807 |
| PENGU | SHORT_VOL5 | 113 | 0 | 67 | 74.63% | 4.073 |
| Q102 | BASELINE | 267 | 0 | 134 | 64.18% | 2.423 |
| Q102 | MARGIN_UPPER20 | 282 | 0 | 140 | 64.29% | 2.286 |
| Q102 | RET14_WIDEN | 294 | 0 | 147 | 64.63% | 2.391 |
| Q102 | REV_LONG_020 | 273 | 0 | 136 | 63.97% | 2.538 |
| Q102 | REV_LONG_OFF | 301 | 3 | 149 | 60.40% | 1.932 |
| RESIDUAL | BASELINE | 842 | 10 | 141 | 38.30% | 0.613 |
| RESIDUAL | RELATIVE_02 | 1278 | 12 | 204 | 42.16% | 0.720 |
| RESIDUAL | VOLUME_80PCT | 935 | 10 | 145 | 39.31% | 0.598 |
| V12 | BASELINE | 1978 | 0 | 1275 | 41.57% | 0.840 |
| V12 | BTC1_ATR07_SCORE85 | 3440 | 0 | 2173 | 41.00% | 0.836 |
| V12 | BTC_0 | 2731 | 0 | 1722 | 40.65% | 0.817 |
| V12 | BTC_1P0 | 2488 | 0 | 1583 | 40.75% | 0.804 |
| V12 | BTC_1P5 | 2260 | 0 | 1445 | 41.04% | 0.853 |
| V12 | MOMENTUM_018 | 1999 | 0 | 1289 | 41.35% | 0.831 |
| V12 | RELAXED_ATR10 | 2277 | 0 | 1449 | 41.34% | 0.838 |
| V12 | SCORE_085 | 2245 | 0 | 1451 | 41.90% | 0.875 |
| V12 | VOLUME_055 | 2411 | 0 | 1444 | 40.79% | 0.806 |
## 保存物と再実行
scripts/research/all_gate_ablation.cjs が比較再生、scripts/research/validate_all_gates.py が集計検証。
Windows worktreeでnode scripts/research/all_gate_ablation.cjs、python scripts/research/validate_all_gates.pyを実行。ソース入口hashはentry-source-manifest.json、全入力・結果のhashはartifact-manifest.json。
本番へのGate緩和は未実施。次の順序は数量丸め修正→Baseline時刻整合の原因分解→V12 Exit parity再BT→Q102等の限定Shadow比較。
