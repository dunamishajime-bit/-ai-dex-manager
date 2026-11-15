# Codex引継ぎ：RENDER既存SHORT初期損切り＋独立OI不要高勝率SHORT（2026-10-25）

## このPushで実装したもの／していないもの

このCommitで**GitHub上の純粋判定ロジック、読み取り専用監視CLI、構造化した実装契約、単体回帰テスト**を実装する。Codexが既存VPSの実Runnerと取引所保護注文ライフサイクルに接続して、現在のProduction SHAへ正しく統合する段階は**別作業**。このCommitだけでは**LIVEは一切有効化されない**。実注文・VPS変更・Production切替・HP反映・安全Gate迂回なし。

本実装:
- \`lib/render-highwr-and-legacy-stop.ts\`：旧ルート専用初期逆行損切り、独立ルートのOI不要シグナル、6h仮想シャドー決済、厳格な当時時点の品質Gate、競合優先順位、実取引用の55分／TP／ハードSTOP計画。
- \`scripts/render-highwr-shadow-review.mjs\`：VPSから取得した完全性確認済み市場スナップショットを入力する**読み取り専用**監視／監査CLI。発注・取消・建玉変更は構造上持たない。障害時はFail Closed。コマンド \`node --experimental-strip-types scripts/render-highwr-shadow-review.mjs /path/to/snapshot.json\`。
- \`tests/render-highwr-and-legacy-stop.test.mjs\`：未完成足・欠損・重複、OI不要、出口、shadow時刻、将来値の混入、既存優先、初期−1%監視を検査。
- \`config/research/render-legacy-adverse-independent-highwr-adoption-20261025.json\`：ユーザー決定と本番統合要件・経済BT参照の定数契約。

## 1. 既存RENDER SHORT：ユーザーが正式採用した初期逆行損切り

ユーザー採用内容：**「−1%に到達した後、2時間経っても−1%以上の損失状態で、エントリー以降の最大含み益が+0.25%未満なら早期決済」**。該当するのは**既存のIDLE RENDER SHORTだけ**。新しい独立SHORTには絶対に適用しない。

現行エントリー／OI Gate、Gross、STOP、TP、利益保護は変更しない。

- 約定価格を基準に、**完全に確定したM5足の終値**で初めて含み損−1%以上になった時刻を記録する。
- その時刻から120分後、確定M5終値でまだ−1%以上の含み損なら監視成功条件。初回接触後に相場が回復すればこの監視エピソードを終了し、その後−1%到達時には新たに2時間監視する。
- エントリーから判定時刻までのM5安値で求める**最大含み益（MFE）**が厳密に+0.25%未満でなければ発火しない（−1%の損切りを勝ちトレードに付け替えない）。
- 条件達成直後は**既存のプロテクションを維持したまま**、Codexが取引所実建玉・未決済・残数量を確認し、翌取引可能時刻にreduce-onlyで閉じる。注文結果不明・部分約定・resync/restartではFail Closedで手動/運用確認する。
- 既存のResident STOPが先に発火済みなら保護注文競合を起こさず、venue上の建玉・保護注文をreconcileする。
- Watch start、lastCompletedM5、MFE、position fill price、旧route、entryTs、clientOrderIdを永続台帳に保存し、再起動後に回復させる。M5欠損があれば監視からの発注を許可しない。
- 個別研究BTでは10bps最終資産差 **+331,651円**、30bps **+117,413円**、DD横ばい、取引回数維持。これは**旧RENDER初期STOP単独の研究ケースであり、下記の独立SHORTと統合した経済BT結果ではない**。

## 2. 新・独立RENDER SHORT：OIを必須にしない、勝率優先

新Route: \`IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT\`。旧RENDER #4427 / 現行IDLEの既存入口と**独立**に、すべての完全確定H1で評価する。**OI / 建玉変化率は発火必須条件ではない。** OI取得失敗でもこの独立エントリーGate自体を停止させない（価格・出来高その他必要データの欠損はFail Closed）。旧ロジックに既存OI要件がある場合は残す。

**正確な原始入口条件（AND）**
1. BTCの直近確定H1価格変化 **+0.15%以上**。
2. RENDERの直近確定H1価格変化 **−0.50%以下**。
3. RENDERの**最後に確定したH4足**価格変化 **−0.15%以下**（形成途中のH4を参照しない）。
4. RENDERの直近確定H1のtaker-sellシェア（base volumeで測定） **53%以上**。
5. RENDERの直近確定H1上ヒゲの長さ **H1の始値比+0.35%以上**。**ローソク足全レンジの35%ではない。** 元研究の変数 \`wickPct=100*(H1high-max(H1open,H1close))/H1open\` に合わせる。
6. 同期間のD1 / 6h出来高中央値等は as-of scoring のために取得。確定済みのD1・連続M5が欠落すれば見送る。

**勝率を選別する6時間の仮想シャドー**
- 原始Gateに通った候補は、たとえ他のポジションで本当はエントリーできなくても、独立6時間の「仮想SHORT」台帳へ保存する。シャドーは実資金ではなく**利益+1.5%、損失−2%、最大6時間**、30bps往復コストで仮想決済する。
- 55分で実取引を終了しても、6時間シャドーの追跡は独立して継続する。M5が欠損している場合は結果未確定にしてGateを通さない。
- エントリー判定時刻より前に**完全に決済済みの**6時間仮想取引だけを履歴に追加。未来の利益を過去の判定に混ぜない。
- 採用Gate（30bps）：累計履歴24件以上、勝率75%以上、PF1.35以上、平均純損益+0.10%以上。過去365日には3件以上・勝率60%以上・平均純損益0%以上。
- 6hシャドーを用いるのは**入口品質判断**のため。実際の独立SHORTは**最大55分**で終了させる。TP+1.5%、Resident hard STOP−2%、新エントリーgross **0.25x**。安全ゲート・費用を無視して強制エントリーしない。
- 終了時刻でvenueへの確実な決済が保証されるよう、Codex側でタイマー・API例外・停電再起動後の補完・STOP/TPの二重発火を認証する。

**競合優先順位**
- 元ロジック・独立ロジックが同H1で候補になった場合、両者ともエントリー時点で確定済みの過去実績（勝率・PF・平均期待値・価格相場特徴スコア）だけで比較。
- データ不足・同じシンボルの保有／pending／保護注文状態不明なら元ロジック保持・独立側Fail Closed。
- 元ロジックの as-of スコアがある場合、独立スコアが元より**8点以上強い**ときだけ優先。それ以外は旧候補を保護。**新旧を二重に発火させない。**
- 新SHORT以外の通貨、V12 / PENGU / Q102 / FET / HYPE / V52 / RESIDUAL、既存TAO・TIA・DOT・JUPの旧判断は変更しない。
- 共有Gross・Margin Guard・Shared Risk・Kill Switch・account/shared lock・rate limit・同一通貨保有上限・12h cooldownを絶対に迂回しない。新独立Routeを「単純な旧IDLEにもう一つ追加」で雑に済ませない。調査BTでは既存TAOとの**資金枠競合**が損益の反転原因になったため、時間枠・他の優良取引への影響を常時監視する。

## 3. エビデンス：混ぜてはいけない2種類の改善

Native8既存基準（2025-08-10〜2026-08-10）10bps **288,587,379円** / 30bps **174,459,200円**。

**独立SHORTだけ**を追加し、55分で終了する研究モデルでは、10bps **289,526,287円（+938,908円）**、30bps **174,993,564円（+534,364円）**。同一通貨・共有口座リプレイでは新4件すべてモデル勝ち、既存取引が消えた件数0、DDは10bps −14.515% / 30bps −15.015%でそれぞれ維持。各コスト3独立再実行の会計と正規化経済台帳は一致。

ただし事後にTAO競合を調べて「55分」を調整したこと、学習済み過去期間を何度も見ていること、取引所の板/実注文保護経路の証拠不足という重要な留保がある。未来も高勝率であるとは証明できていない。実際の保有55分版シャドー歴まで変えて厳しい勝率Gateにかけると発火0件であり、**6h仮想shadowを実55分とは別に記録する実装が必要**。

**ユーザーが今回採用した既存RENDERの「−1%→2時間→MFE<0.25%」と、独立SHORT新設を同時に組み合わせたNative8経済BTは未実施。研究Aの改善額+Bの改善額を足して予想利益と言ってはいけない。** Codexは統合時に10/30bpsを動的再選択で再BTし、旧約定の消失0、DDの悪化なし、PF/最終資産非悪化を確認すること。

## 4. CodexがVPSに反映する具体的作業

1. 本研究Commitをcheckoutし、現在VPSで稼働中の**実Production SHA・Runner PID・実取引所建玉/open orders/保護STOP/Pending/Shared Risk**をread-onlyで先に確定。現在のProductionとの差分・ロールバックSHAを残し、Codex側で本研究コードを取り込む。ロジックの古い別ブランチへ巻き戻さない。
2. 現行 \`lib/idle-priority-short-runner.ts\` / \`lib/idle-priority-short-state.ts\` のholdHoursは12|24前提。新55分SHORTを適当に既存12h routeに見せかけて追加してはいけない。**新独立route専用の永続スキーマと時間Exit/Stop lifecycle**を実装し、旧Runnerと独立／優先所有権を証明する。
3. \`lib/render-highwr-and-legacy-stop.ts\` の純粋関数を連続M5/H1市場データへ結線。Venueの確定5分足（open/high/low/close/baseVolume/takerBuyBaseVolume）と、実約定価格・Open Interest（旧が要求する場合のみ）をそれぞれ型検証する。データ断絶・時刻不一致はFail Closed。
4. 新エントリーは原始Gate→6h終了済shadow品質→同シンボル旧候補とのas-of順位比較→共有資金/建玉/注文/利用可能Gross→Resident STOP/TP lifecycle承認、の順序を保持。新規注文前にStop設置・reduce-only readbackが保証できなければ見送る。
5. 元RENDER SHORTだけに初期逆行STOPの監視stateを加える。実約定が存在するポジションだけを対象にし、決済理由と仮想shadow評価を分離保存する。
6. 10bps/30bpsの**両方で統合BT**を最新Task9/現行本番条件から再生成、寄与を旧・新・他通貨に分ける。DD悪化・既存優良取引喪失・不確かな実注文保護なら本番発注は許可しない。
7. VPSへ導入後は**Forward SHADOW→少数候補の実績評価→明示的運用承認**の順に進む。未証明のまま自動LIVEを有効化しない。いつでもrollbackできるようRelease SHAと対応runner/configを固定する。
8. 監視表示・台帳：H1 signalTs、Gate pass/fail理由、BTC/RENDER H1、確定H4/D1、sell share、wick_pct_of_open、shadow lifetime/365day N/WR/PF/mean、旧候補比較順位、拒否理由、次の新候補Cooldown、他の候補逸失、実約定・STOP/TP読戻し・55分経過時Exit、Max loss/MTM DDを記録。OI欠損は**独立ルートのGate拒否理由にしない**。旧は旧のOI契約を保持。

## 5. 手元のテストと監視

Node v24環境：\`node --experimental-strip-types --test tests/render-highwr-and-legacy-stop.test.mjs\`。ライブラリはI/Oも秘密鍵も注文機能も持たず、\`scripts/render-highwr-shadow-review.mjs\` は外部のreadonly-snapshot JSONを引数にして安全判定をJSONとして出力する。接続・stateの永続化・ログ監視／通知／実約定との突合はCodexがVPSで配線する必要がある。ログに秘密鍵やAPIトークンを入れない。

## 6. Codex完了報告の必要条件

- current Production SHA / new SHA / rollback SHA / runtime branch, プッシュ確認、Runner PID/NRestarts、CI/テスト。
- 6h仮想Shadowの継続・再起動後復元と55分の時間出口の実機確認。
- 旧RENDER初期逆行STOPが新独立SHORTには一度も発火しないこと。
- 新独立SHORT OI不要、旧ロジックのOI条件維持、同シンボル二重発注なし。
- 高勝率シグナルを選んでもTAO/TIAなどの優良取引が排除されない、あるいは除外時は理由・利益機会損失を算出する。
- 共有リスク、account lock、rate budget、venue STOP/TP reduce-only、部分約定、Timeout/キャンセル・再起動復元の実証結果。
- LIVEオン／オフとShadowの区別、未証明項目、監視結果を根拠つきで報告。

**研究結果を示すだけで「FULLY_VERIFIED LIVE」と呼ばないこと。**
