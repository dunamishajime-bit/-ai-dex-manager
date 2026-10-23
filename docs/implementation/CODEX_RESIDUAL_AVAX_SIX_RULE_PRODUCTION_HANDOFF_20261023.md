# Codex引継ぎ：RESIDUAL AVAX LONG 新規6ルールのProduction実装・LIVE認証（2026-10-23）

**STATUS: USER_ADOPTED_IMPLEMENTATION_HANDOFF / RESEARCH_CODE_PUSHED / PRODUCTION_NOT_YET_CHANGED**

Repo: `dunamishajime-bit/-ai-dex-manager`
Research branch: `research/residual-entry-exit-deep-20261023`
Locked economic research reference SHA: `222f9a4e170d0808f516aca11343336b91748659`

## Codexが行う作業

このcommitおよび下記一次資料の**全文**を確認し、既存LIVEランナーの実装に本仕様を統合する。これらは`scripts/dd-reduction`内の**研究コード**であり、現行Productionに自動的に繋がっていない。別の既存Runnerへコードをコピペするだけで「LIVE完了」にしない。今回はユーザーの意図に従い**GitHubへ実装引継ぎをPush**する工程である。実発注を伴うLIVE切替は、下記の取引所STOP実証と運用認証が完了してから別工程で行う。

最初に参照：

1. `docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_COMPOSITE_ENTRY_VETO_FINAL_DECISION_20261023.md`
2. `docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_WATCH35_HARD5_FINAL_DECISION_20261023.md`
3. `docs/implementation/RESIDUAL_AVAX_RISK35_HARD5_LIVE_CONTRACT_20261023.md`
4. `docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_COMPOSITE_ENTRY_VETO_FULL8_20261023.json`
5. `docs/research/results/residual-composite-20261023/RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json`
6. `scripts/dd-reduction/research-residual-avax-risk35-hard5-policy-20261023.py`
7. `scripts/dd-reduction/research-residual-avax-watch35-hard5-native-full8-20261023.py`

## 対象と固定条件

対象は**RESIDUAL所有のAVAXUSDT LONGだけ**。他7戦略（V12、PENGU、Q102、FET、V52、HYPE、IDLE）および他戦略が所有するAVAX注文・建玉を変えない。RESIDUAL DOGEの新規入口は引き続き見送る。リスクヘッジの導入による資産減少は許容し、トレード数をむやみに減らす新Gateは追加しない。

### 入口2条件（OR いずれか成立で新規見送り）

1. 直近確定AVAX3時間騰落率 **≤ −0.5%** かつ直近確定BTC3時間騰落率 **< 0%**。
2. 直近確定AVAX6時間騰落率 **≥ ＋2.0%** かつ直近確定BTC6時間騰落率 **< 0%**。

いずれも決定時点より前の**確定済みM5足**による因果判定。欠損や不一致を推測値で補完して発火しない。

### 既存複合出口2条件

3. **最大保有6時間**。従来の正常な先行EXITの時刻を上書きしない。
4. 5分足確定終値で一度**+3.0%**含み益到達後、最高含み益から**1.5パーセントポイント逆行**したらトレーリング決済。固定の建値+1.5%利確とは異なる。通常保護注文との先行関係を維持。

### 新規保護2条件（安全優先）

5. **−3.5%に一度でも触れたら2時間監視**：建値比**価格**−3.5%以下の初回タッチ時刻を保存し、途中回復してもタイマーを更新しない。初回タッチから2時間経過時にも価格が−3.5%以下なら、当該RESIDUAL所有ロットのみ reduce-onlyで決済。回復していれば監視状態解除、再接触なら新たな監視開始。研究M5モデルと違い本番では取引所の実際の時刻と価格更新イベントで判定し、M5完成を待たない。
6. **−5.0%の即時緊急STOP**：平均実約定建値比の価格下落率が−5.0%に達した場合、2時間待たない。エントリー時点から**venue側ネイティブSTOP MARKET**、close-only／reduce-only相当、現数量をカバーする注文のACKと定期再照合を必須にする。急変ギャップで実損が5%を超える可能性はある。

### 決済・注文の競合／所有権

- ハード−5%STOPは優先保護。通常の先行決済と競合した際は重複売却やショート反転を発生させない。
- 部分約定、キャンセルACK、再注文、建玉増減、ポジション・注文の永続所有権、ネット／ヘッジモード、Rate Budget、Shared Risk、Margin Guard、Kill Switch、account lockを継続監査。いずれか不明なら新規発注Fail Closedと明示的アラート。
- `first_touch_at`, `watch_deadline_at`, `entry_avg_fill`, `owned_qty`, `protective_order_id`, `protective_qty`, `venue_order_status`を永続化し、再起動でも復元する。
- 元のH1研究約定価格とM5 spot openとの乖離がモデル上2.5%超の候補もあった。価格補正は研究専用で、LIVEは**取引所の実平均約定価格と実測トリガー価格の正本**を使用し、研究の便宜上の乖離許容をLIVE判定に流用禁止。
- 取引所のSTOP MARKETがサポートされない場合、ポーリングSTOPを「即時」として認証しない。

## 本番反映前の検証必須

1. 部分約定・利益保護・6時間TIME・−3.5% 2h期限と再監視・−5% STOP・急落ギャップ・再起動時STOP保護復旧・クールダウン・他戦略所有数量をカバーするユニット＋統合テスト。
2. 10bps/30bpsで既存8ロジック研究BTと、ユーザー採用条件をそのまま使った取引台帳／注文理由の差分分析。研究モデルは2025-08-10〜2026-08-10、AVAX18件、−3.5%監視と−5%はどちらも発動0件、基準資産10bps ¥268,310,796 / DD−14.51499%、30bps ¥158,222,978 / DD−15.78569%。**実際の急落経路は合成テスト11件PASSのみ**なので本番発注証拠にはならない。
3. Canary／実venueの注文ACK・建玉数量・STOP保護注文IDと状態・部分決済・再起動復元・終了取消ACKを記録。失敗時は既存LIVEを維持し、ユーザーへ正確な理由を報告。
4. GitHub Push、CI、commit SHA、選定された本番Runtime SHAとリリースID、rollback SHA、全Runner/PID/NRestarts、positions/orders、HP判定／発注理由、Account Lock/Shared Risk/Margin Guard/Kill Switchを監査する。
5. 分析研究完了・コード実装完了・実資金LIVE稼働を**別ステータス**として報告し、未証明の実取引所ライフサイクルをPASSと偽装しない。

## 現在の状態

研究コード、因果11テスト、8ケース統合再選択BT、GitHub Pushまで完了済み。**Production ランナーへの配線、保護STOPのvenue実装、正式認証、LIVE切替はこのHandoffでは未完了**。

ユーザーに明確に承認された範囲の変更のみ進め、他戦略の出口・勝率・Grossやリスク上限を勝手に変更しない。
