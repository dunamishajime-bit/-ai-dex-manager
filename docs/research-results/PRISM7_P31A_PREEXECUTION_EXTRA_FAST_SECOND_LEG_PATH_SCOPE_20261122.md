# P31A — 実行結果閲覧前の追加反証スコープ固定

本レポート作成時点ではP31の人工未来価格・SOURCE stop72再生・経済結果を**一度も実行していない**。元事前仕様P31の2未来 `RECOVERY_CONTINUES` と `SECOND_LEG_CRASH`（slow down、24H時定数）は全条件/閾値/マスク/費用を変更せず保持する。

SOURCE比較用 `REFERENCE_STOP72` は前完成H1の最安値に4%の買戻しtrailingを採用するため、初回の小さな買い回復が続くと「後続急落がある前にSOURCEが止めていた可能性」がある。そこで**第二の反証**として、21:25以降の将来下落を24Hではなく**1Hの時定数**で `0.0107→0.004 USDT`へ落とす `SECOND_LEG_FAST_CRASH` を追加する（BTCは既存下落世界と同じtarget95000/tau24H）。21:25より前のPENGU/BTCの源prefix・回復確認時刻・最初の正印字OPEN `0.0107` は**3世界すべて完全一致**。急落に続くsource trailing/STOP/preemptionを経済モデルで正式に再生する。回復後の世界ラベルをP30 EXITへ渡さない。

これにより人工世界3種類（RECOVERY_CONTINUES, SECOND_LEG_CRASH[tau24H], SECOND_LEG_FAST_CRASH[tau1H]）×8seed×3正出来高mask=**72 futures**、2EXIT delay×2fee×3extra-slip=**864 cases**。元P31の2未来は全部含み、後から都合よく除外しない。試行する前にこの仕様をGitHubへPushし、その後結果を見ても閾値や未来モデルを変えない。

元SOURCE PENGU native SHA1657e...とP30source/研究only条件は不変。Production/master/VPS/注文/STOP/Runner/建玉/KillSwitch/HYPEは未変更。
