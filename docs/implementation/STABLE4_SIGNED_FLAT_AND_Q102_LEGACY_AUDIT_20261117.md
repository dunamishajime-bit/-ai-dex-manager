# STABLE4 取引所署名付きGET・Q102旧状態監査（2026-11-17 JST）

## 取引所の読み取り専用照合

PCに既存保存されたSSH鍵とknown_hostsを用い、XサーバーVPS rootへの既知ホスト鍵認証済み接続から、現在の稼働Q102リリース `ef1ab178e26a7bf5bddb6473467765edba242e1d` に固定された診断スクリプトを実行しました。

- 読取専用診断ファイル：`scripts/disdex-aster-readonly-account-diagnostic.ts`
- リポジトリの旧Q102固定Git blobと、VPS上の実ファイルのSHA256：双方`e624fdb10a70619011a93f6bbebe4c015d3cc9d9a8738414e6c9f59acf096c08`で一致
- 既存のQ102プロセスの認証環境は`/proc`から実行プロセス内部のみへ制限して引き継ぎ、秘密鍵や生の口座残高・価格・注文IDを出力していません。共通の既存APIレート予算を使用。既存SDKの`getServerTime/getBalances/getPositions/getOpenOrders`だけを呼び出し、注文/取消・決済・本番設定書込は0件。
- 取引所署名付きGETの`ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS`と、戻り値の`ordersSent=0/cancelsSent=0/positionChangesSent=0`を検証。観測時刻 `1794868017390` ms UTC epoch、取引所時計`1794868016875` ms。
- **取引所全体のポジション0件・未約定注文0件**。これはこの1回の署名付きGET時点の照合であり、以後のフラット保証や保護STOP永続証明ではありません。

## 旧Q102状態の実装整合

旧Q102実ソース `ef1ab178...` の`Quality102CausalV1State`では、`position?`・`pending?`は**省略可能**です。最初の読取専用検査はこの両方を必須と誤認したため、その検査結果は採用せず、固定ソースの正確なschemaに合わせて修正しました。

- コミット`d712c29cd4158c666a377d3afa2629628cb270de`：version=1、strategyId、failures配列の正当性、runtime sourceSHA、mode、更新時刻を照合し、任意の`position/pending`項目が存在しないケースを安全に扱う。
- 修正後のVPS監査：旧Q102プロセスはactive、MainPIDとcwdは旧ソースと一致。旧ローカルstateではposition/pending項目は不在ですが、`updatedAt`が経過しているため`BLOCKED_LEGACY_STATE_OR_FRESHNESS_UNVERIFIED`。**書込排他未証明**、新bootstrap未設置、正式Owner承認未取得。
- 修正後のPythonテスト：Q102専用12件PASS、Root系64件うち10件期待スキップ、失敗0件。新コードのGitHub Actions `43969724684` success。

## 残る切替前ステップ（DD研究延期の指示を反映済み）

1. 元のQ102 Writer排他と新Q102 Native parser/bootstrapの`DRAFT_BLOCKED`解消。現在の口座フラット状態だけでは、稼働中旧Writerを止める・新Writerへ切替える正式な根拠にならない。
2. 旧Q102 stateの最新frontierを20銘柄の確定済H1足で追いつかせる。既存の復旧52件は47件確定・5件明示未解決（APT3/FET2）、AVAX別系列4件pending。source-/evidence-hashと時刻検証が必要。
3. 21 Rootモジュール現物SHAは一致済みだが、外部動的loaderと残りの実行経路・rollbackの正式な証明が未完了。
4. 候補SHAのimmutable releaseをステージし、Owner exact operation/scope/SHA/planを正規HPで承認。既存Gross/DD/Shared Risk/STOPの実行時安全ガードは変えない。
5. 署名付きGETは正式切替の直前に再度実行。今回の成功は長期間使い回さない。

**研究BTの最大DD20%合格はOwner判断で切替後へ延期。上記安全と正式承認ゲートは延期しない。**

本作業は読取専用の検証に限定し、注文・取消・建玉・STOP・Kill Switch・Runner切替を行っていません。
