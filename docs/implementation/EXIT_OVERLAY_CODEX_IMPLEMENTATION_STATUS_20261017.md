# Q102 / HYPE / Idle DOT・RENDER 実装状況 (2026-10-17)

## Status

`IMPLEMENTED_IN_ISOLATED_WORKTREE_NOT_LIVE`

この文書は、研究handoff `6c9b9d032a18c44c82fcfd2f5a74226d71d68160` の5項目を、Production base `ea289577256af9c19544a1883013a128bbb53ec5` から作成した実装branchへ移植した記録です。研究branchをProductionへ直接deployしていません。

## 実装した契約

- Q102: `QUALITY102_Q102_PROFIT_FLOOR_ENABLED=true` のときだけ、確定済み5分足の有利+2%観測後に建値有利+0.5%のresident STOPを有効化。未確定足、重複足、5分足取得不能はFail Closed。
- HYPE LONG: 実fill数量・実fill価格・受理Gross・口座equity・コストからwallet loss 2%相当STOPを計算。既存のsignal STOPより緩くしない。入口・ZEC・PENGUは変更しない。
- Idle DOT/RENDER: requested/accepted Grossを0.25xへ固定。部分Grossは拒否。
- Idle DOT/RENDER: 確定5分足の有利+3%で追走をarmし、最高確認終値から1.5 percentage pointのgivebackでSTOP。交換所read-back後に新STOPを有効化し、旧STOPを取消す。失敗時はmanual review。
- Idle JUP/TAO/TIAおよびPENGUの入口・Sizing・出口は今回変更していない。

## 重要な安全境界

- Q102の5分足機能は環境変数が明示的にtrueになるまで無効で、既存Productionの出口挙動を暗黙に変更しない。
- DOT/RENDERの5分足providerは最新の完了足のopen timestampを厳密に要求し、形成中・欠損・不正OHLCを拒否する。
- Idleのtrail状態は`trailArmed`、最高確認利益、STOP価格、最終確認5分足時刻を状態ファイルへ保存し、再起動後に復元する。
- 追走STOPは新注文のread-backを確認してから旧STOPを取消す。新注文または取消のread-backが不一致なら保護状態を未認証のままmanual reviewにする。
- shortの追走STOPが建値より下へ移動するのは、追走がarm済みで新STOPが保護済みの場合だけ許可する。
- 実注文、取消、建玉変更を検証のために発生させていない。

## 検証

- `tsc --noEmit -p tsconfig.json`: PASS
- `tsc --noEmit -p tsconfig.research.json`: PASS
- exit overlay contract: 6/6 PASS
- resident STOP: 12/12 PASS
- Idle contract suite: 55/55 PASS
- HYPE contract suite: 48/48 PASS
- Q102 contract suite: 34/34 PASS
- Q102 runner self-test: PASS; real/test/synthetic orders 0
- Q102 live-runner self-test: PASS; orders 0
- Q102 state self-test: PASS; profit-floor metadata save/reload included
- Idle live self-test: PASS; orders/cancels/position changes 0
- HYPE runner self-test: PASS; liveOrders/cancelOrders/positionChanges 0
- Shared Risk self-test: PASS
- research handoff static validator: PASS (`MODEL_HANDOFF_STATIC_PASS`)

## Backtestの扱い

研究branchの保存済みstatic evidenceは10bps/30bpsの12ケース、会計照合、0.25x上限、5分足出口の検証にPASSしています。しかし、handoffの完全replay scriptは凍結されたBinance Vision 5分足ZIPを `Desktop/idle-exit-deep-research-20261016/monthly_zip` から読む設計で、このPCにはその凍結データが存在しません。また、研究モデル自体がAsterの署名付きfill、Mark Price、板、partial fillを再現するものではありません。

したがって、保存済み研究数値を現Production parityやAster実約定認証として扱っていません。完全BT再実行、独立holdout、Aster lifecycle証明は未完了です。

## VPS read-only監査（実装前）

- current: `/home/deploy/disdex-trading/releases/ea289577256af9c19544a1883013a128bbb53ec5`
- marker: `ea289577256af9c19544a1883013a128bbb53ec5`
- current V12 V4 service: separate `6f97d2cf03877674ec1a845f6c08414f32899f36` release
- Aster read-only: JUPUSDT SHORT 202、STOP/TP各1、いずれもreduceOnly、orders/cancels/positionChanges = 0
- Shared Kill Switch: false
- Shared Crypto Daily Risk: tripped false、maximumLossPct 7.5、sourceComplete true
- VPS disk: 48G中44G使用、空き3.9G（92%）

この監査後もVPS current、systemd、operator artifact、状態、建玉、保護注文を変更していません。
