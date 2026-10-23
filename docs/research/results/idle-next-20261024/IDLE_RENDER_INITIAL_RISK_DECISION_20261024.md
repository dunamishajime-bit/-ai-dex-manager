# Idle Priority SHORT／RENDER初期逆行と勝率の検証（2026-10-24）

**STATUS: RESEARCH_ONLY. LIVE / PRODUCTION / VENUE / HP NOT CHANGED. HOLDOUT AND VENUE EVIDENCE NOT PROVEN.**

## 最新累積BTとデータ固定条件
- 検証期間は2025-08-10から2026-08-10、10bps基本・30bps費用ストレス。既存8ロジック共有財布・資金再配分・3回の再選択、全経済BTは会計PASS。
- AVAX6条件・PENGU SHORT 3時間−2.5%／8時間−4%・PENGU通常LONG 8時間−5%と24h cooldown、Recovery V8 24時間−3%の研究候補をすべて同条件に固定。
- RENDER SHORTの既存利益保護やIdleのATR・Gross・他の通貨入口を変更していない。今回の新規候補はRENDER SHORTの初期逆行損切りのみ。
- 10bps統合基準：最終資産 278,755,397円、DD -14.51499%、1288件。
- 30bps統合基準：最終資産 168,977,922円、DD -15.01472%、1284件。

## 採択済みIdle SHORTの特徴
| 通貨 | 10bps勝ち／総件数 | 30bps勝ち／総件数 |
|---|---:|---:|
| RENDERUSDT | 15/24 | 10/22 |
| DOTUSDT | 20/30 | 20/30 |
| JUPUSDT | 3/7 | 4/8 |
| TAOUSDT | 5/5 | 5/5 |
| TIAUSDT | 4/4 | 6/6 |

- RENDERの現行利益保護後も30bps勝率が低い。M5の全採択Idle経路（10bps計70件、30bps計71件）を照合。
- 総240候補の時間・損失閾値・最大含み益Gateを検査。RENDERの3h連続−2%型は過去の負け5件、−1%タッチ後2h監視型は負け4件に作用し、選択済み旧勝ちの早期決済0件。ただしこれはスクリーニングであり統合経済結果ではない。

## 全8ロジック動的統合BT：基準との差

| 条件 | 10bps最終資産 | 10bps資産差 | 10bps DD | 10bps取引 | 30bps最終資産 | 30bps資産差 | 30bps DD | 30bps取引 | RENDER新STOP（10/30） |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RENDER −2%が3h連続／MFE＜+1% | 277,982,948 | −772,449 | -14.51499% | 1288 | 168,208,944 | −768,978 | -15.01472% | 1284 | 5/5 |
| RENDER −1%タッチ後2hも損失／MFE＜+0.25% | 279,087,048 | +331,651 | -14.51499% | 1288 | 169,095,336 | +117,413 | -15.01472% | 1284 | 4/4 |
| RENDER 4h後−1%／MFE＜+0.25% | 278,795,599 | +40,202 | -14.51499% | 1288 | 168,850,731 | −127,191 | -15.01472% | 1284 | 4/4 |

## 採用判定と注意
- 旧負けトレードを数件だけ先に切る候補は、全ポートフォリオで資金再選択が変わりDD・収益が必ず改善するとは限らない。静的なトレード単体の損失救済を採用根拠にしない。
- RENDERの3h連続−2%は採択済み負け5件にヒットしたが、経済BTでは両コスト減益・DD改善なしなので不採用。
- −1%到達後2h監視＋MFE+0.25%未満は両コストで微増益・DDと取引数維持のため第一 Forward Shadow 候補（正式LIVE採用ではない）。
- RENDER入口改善として過去研究のBTC6h強気・銘柄相対6h強気時のSHORT vetoは別途有望だが、今回の最新PENGU・AVAX累積基準での統合経済BTは未完了につき、新規採用していない。
- 既存のPENGU採択トレードのentry時刻・決済時刻・決済価格は、追加候補の個別台帳監査で確認。比較レポートに記録した。
- 240条件の同一期間探索につき多重比較の過学習リスクが高い。RENDER 10bps24件・30bps22件しかなく、OOS・独立Forward・取引所約定実証は未完了。
- モデル約定は確定M5終値で判断し次M5 openで執行した仮想fillであり、実際のSTOP-MARKET約定、部分約定、reduce-only、資金調達、注文競合、再起動復元等は認証されていない。
- 今回は研究用であり、Production / VPS / 実注文 / HP のいずれにも変更はない。

## 追跡・再現
- scripts/dd-reduction/screen-idle-next-m5-after-pengu-20261024.py
- scripts/dd-reduction/run-idle-render-after-pengu-full8-20261024.py
- scripts/dd-reduction/audit-idle-render-full8-after-pengu-20261024.py
- docs/research/results/idle-next-20261024/IDLE_SHORT_CURRENT_CUMULATIVE_M5_LOSS_SCREEN_20261024.json
- docs/research/results/idle-next-20261024/IDLE_RENDER_AFTER_PENGU_NATIVE_FULL8_AUDIT_20261024.json
