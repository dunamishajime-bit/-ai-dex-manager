# Codex依頼文 — V12 V4 最終認証・条件付きProduction LIVE切替

対象: `dunamishajime-bit/-ai-dex-manager`
実装ブランチ: `codex/v12-v4-production-cert-20261009`
本番候補: 本ファイルが格納されたブランチの **最終 remote SHA** を取得して不変固定
採用ロジック: `V2_M150_D05_CORE_NATIVE` / 41ルート
既存Production基準: `ce1edeead8d0f9e5d88e829d415057117502a335`

## 依頼の目的

すでにPushされたV12 V4を、研究・本番条件・取引所保護・他Runner
との共有Gross・再起動・ロールバックまで**実証できた場合だけ**、
旧V12から切り替えてLIVE稼働させ、HPへ反映してください。
後戻り防止のため、Researchの再実装・勝手な条件緩和・固定Gateの
削除・認証ファイルの捏造はしないでください。

## 必ず全文確認する一次ソース

1. `docs/implementation/V12_V4_CODEX_FINAL_CUTOVER_HANDOFF_20261010.md`
2. `docs/implementation/V12_V4_PEER_OWNER_LIVE_COMPATIBILITY_20261010.md`
3. `docs/implementation/V12_V4_SIXTEEN_HISTORICAL_INDEPENDENT_PARITY_20261010.md`
4. `docs/implementation/V12_V4_PRE_FORMAL_INDEPENDENT_ROUTE_EVIDENCE_20261010.md`
5. `docs/ops/V12_V4_FINAL_TECHNICAL_AUDIT_20261010.md`

次の既存記録の真偽と範囲を取り違えないこと:

- 研究元正式1年・10bps: 1,222総取引、V12 828件、
  最終¥291,326,102.6203428、DD -20.420013795%。
  これは**モデルBT**であり、将来の利益を保証しません。
- 別の外部検証期間: 25/41ルート、Entry/Exit 258/258一致。
- 正式BTの16不足ルート: 212/212 Entry・順位・Gross、
  212/212独立計算Exit時刻・価格・理由一致。
- 正式BT開始前の追加期間: 16中11ルートで候補178件、
  独立計算Entry・Exit 178/178一致。
  残る5ルートは追加期間でも未発火、**41/41外部実績PASS
  と申告することは禁止**。
- 外部期間のPF悪化・Y06低成績の既存研究結果を隠さず、
  最終採用リスクはオペレーターの承認対象とする。

## 実行順序と本番移行の絶対条件

1. 最新remote SHAを固定して、`tsc`、V4関連テスト、Linux全回帰、
   UI契約・Productionビルド、研究エビデンスのSHA照合を実施。
   `scripts/v12-v4-cutover-evidence-preflight.ts` のBLOCKED状態を、
   認証省略ではなく真正なエビデンスの積み上げで解消すること。
2. Xserver VPSの最新read-only実口座照合。Aster資産・建玉・
   未約定/保護注文・一時注文・shared pending・Kill Switch、
   Margin Guard・Gross予約を**同一基準時刻**で照合。
   前回の読み取り専用診断では建玉0・未約定注文0だったが、
   現在もflatだと決めつけず必ず再取得。
3. AsterのSTOP_MARKET、reduceOnly、実約定平均価格、価格刻み、
   最小数量、部分約定、STOPと個別EXITの競合、同通貨複数レッグ
   と再起動時の旧STOP整理について、独立した証拠を残して認証。
   デモ実績・既存取引署名ログ・交換所ドキュメントを優先。
   **不必要な実マネーのTEST注文を発行しない**。認証不能ならBLOCK。
4. V12旧Runnerは正常な既存ポジションを勝手に決済しない。
   旧V12のopen/pending/STOPがflatと照合できた場合だけ、
   watchdogによる再起動を封じた上で旧エントリー権限を停止。
   新V4との二重エントリーを厳禁。
5. PENGU/Q102/V52/FET/HYPE/IDLE/RESIDUAL各系統は同じ
   **最終Production SHA** のsystemd実行ファイル・PID・
   WorkingDirectory・実状態ファイル・pending/建玉・Broker数量
   が一致することを実機で証明する。RESIDUALはIDLEの配下。
   PENGUの現在の状態ファイルは
   `/var/lib/disdex/pengu-dual-ls-v2/runner-live.json`、
   V52は`/var/lib/disdex/v52-aster-only/runner-live.json`。
   `deploy/systemd/disdex-v12-v4.env.example` とV52のSHA
   drop-inは**サンプル**であり、そのまま既存LIVEを上書きしない。
6. V12 3.0x、Crypto総枠3.5x、Total 4.75x、
   Recovery 2.5xおよび共有予約・DD21%許容の採用条件と、
   それぞれの既存Runnerの本番認証を一致させる。
7. TIME37の非常用固定8%STOPは**未承認の研究候補**。
   正式採用する場合、手数料10/20/30bps・DD・取引時間制限・
   mark/last値動きとAsterでの実執行を再照合し、
   別途明示的なオペレーター承認を得ること。
   未承認の`/etc/disdex/v12-v4-time-stop-approval.json`や
   `/etc/disdex/v12-v4-production-certification.json`を
   勝手に作成/署名しない。root所有/読み取り専用/最終SHA一致必須。
8. 運用責任者から、上記実行証拠・外部期間の低PFリスク・
   停止/復旧ルール・実注文権限について、正式なLIVE承認を得る。
   すべてPASSかつ承認済みの場合のみ、Rollback用旧releaseを残して
   旧V12→新V4のsystemd切替を原子的に実施し、
   本番のシグナル判定→発注→保護STOP→実約定照合を監視。
9. 成功した場合に限りHPのRunner・判定状況・候補・履歴・
   決済理由・Production SHAを新LIVEデータに同期し、
   新旧UIデータの混在を避ける。GitHub Push、CI、systemd、
   Aster readback、HP公開証拠、Rollback動作を報告。

## 停止条件と最終報告書

一つでも未成立なら**既存Productionを維持**し、実建玉・
保護注文・Operator artifactは変更せず、BLOCKED項目・
原因・最後に確認したread-only証拠・次の実行可能手順を具体的に
報告すること。Researchの入力CSVやテスト用モックを署名付き
取引所の認証実績と偽らない。

最終報告必須: 実行最終SHA、全41ルートの証拠範囲、
採用STOP方針と明示承認の有無、Gross/DD上限、全Runnerの
サービスと状態ファイルのSHA、署名付き実口座保護の状況、
CI・HP本番URL、LIVE_READY/LIVE_ACTIVE/BLOCKEDの正確な状態。
