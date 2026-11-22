# PRISM VII P31 — 回復確認まで完全に同じ価格履歴から再下落と上昇に分岐させる強い反例（結果算出前固定）

**目的**：P30 buyer-recovery-confirmed EXITはP29のCONTINUE_DOWNでは元のSHORT利益を維持した。しかしP30で作ったFALSE_BOUNCE_DUMP人工世界はSOURCE reference STOPが先に利益の一部を失うシナリオだったため、回復確定後の二段目下落を待つと元SHORT勝ちの利益を大きく失う**本当の反証を構成していない**。新たな将来はP30の結果を見て後から設計しているので、この試験は証明用の独立市場OOSではなく、反証に絞る。元SOURCE実市場価格・SOURCE pin1657e173d250ad58f53e62f7bb0a3428fb405496、実注文は絶対変更しない。

## 共通の過去を「買い回復が確定する時点」まで延長
- 全ケース共通の既知2025-10-10 PENGU SHORT ENTRY0.022617、SOURCE M5 21:15 OPEN0.022617,HIGH0.023038,LOW0.01,CLOSE0.01,vol1363556 とBTC同時計時M5 CLOSE104694.7。
- 次の21:20 SOURCE模型 M5を**全ケース完全同一**に固定：PENGU OPEN0.010000,HIGH0.010750,LOW0.009950,CLOSE0.010700、positiveVolume100000、takerBuy50000；BTC OPEN104694.7,HIGH105800,LOW104600,CLOSE105500、volume1000/takerBuy500。BTC+0.77%, PENGU+7%でP30 BUYER_RECOVERY条件を21:25 UTCに**完全確定**。元P30のPENGU+1%,BTC+0.5%,陽線判定から1文字も変えない。
- **新しい反事実未来は21:25UTC（BUYER_RECOVERYシグナル完了後）から初めて違う**。ここが真の「同一過去かつ同一回復確認」の二世界。将来シナリオラベルをP30出口条件に使わない。

## 元SOURCE参考STOP72に対する反証2世界

1. `RECOVERY_CONTINUES`：21:25のPENGU初回正印字OPENは両世界同じ0.010700、その後のM5 CLOSEは指数時定数tau1Hで最終target0.021 USDTへ上昇。BTC M5将来は106000～115000へ回復（将来世界ラベルは全く売買判断に使わない）。
2. `SECOND_LEG_CRASH`：21:25のPENGU初回正印字OPENは全く同じ0.010700、その後指数時定数tau24Hで最終target0.004 USDTへ下落。BTC M5将来は105500から95000へ下落。SOURCE REFERENCE_STOP72 は source PENGU M5 barのHIGH/完成H1 lowを再現して元モデルを時間順に採点。いずれも元source native phase/deadlineと同一ではない。
- 各世界×8位相seed×3positive M5マスク（連続/3本に1本/12本に1本）＝**48人工未来**。future M5 OPENは直前の正出来高CLOSEからスタート、HIGH/LOWはOPEN/CLOSE最大最小±0.2%、vol100000/takerBuy50000で固定。印字なし足はcarry forwardし、その価格を実市場の発注可能値と主張しない。
- P30の固定 `detect_buyer_recovery` 関数を**そのままimport**して全世界に適用。P30が既に共通prefix21:20の確定でRECOVERY_CONFIRMEDになるはず。実際のBUY価格は次のpositive PENGU M5（21:25OPEN）でシグナル後第1、第2printを固定。SOURCE STOP先着は参考STOP優先。世界の勝敗結果を見て出口ルールを書き換えない。
- 48×2 positive print delay×2fee10/30bps×3extra slip0/100/1000bps = **576 source価格代理個票**。SOURCE勝ち→P30利益低下数・SOURCE損失→P30改善数・方向世界毎のmean net/PF、up vs downで同一情報から異なる最適行動になること、次positive印字までの先行stop/薄い流動性を全件残す。
- `SECOND_LEG_CRASH`でP30が決済せずREFERENCE_STOPを優先できればまだ勝者利益が保護された可能性を報告し、**P30が早決済してSOURCE勝者を削る反例が成立した場合は、P30も一般LIVE採用不可**と記録。結果に合わせて閾値・seed・path・maskの調整をしない。

これは人工市場の反実であり、独立実市場OOSではない。元H1源自然S4 setup120を別研究で使った経済勝率71.43%を80%に偽装しない。DD20%はP30実市場25.23%で不合格のまま。SOURCE sourceマーク価格・bid/ask/real signed fills/他Runner Gross・Funding/SharedRisk欠損。master/VPS/Runner/STOP/注文/建玉/KillSwitch/HYPE未変更、GitHub Draft PR #595研究だけにPush。
