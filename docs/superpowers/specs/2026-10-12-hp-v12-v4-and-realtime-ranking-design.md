# HP全ページのV12 V4統一とリアルタイム順位・Score改善 設計

作成日: 2026-10-12
状態: ユーザーレビュー待ち（設計書のみ。実装・デプロイ未着手）

## 1. 目的と成功条件

HP上の「現在のV12」表示、判定情報、設定説明を、正式候補 `V2_M150_D05_CORE_NATIVE` / 41 routes に対応させる。同時に、リアルタイムページで発生している次の問題を、売買ロジックを変えずに解消する。

- Scoreが得られている通貨が少なく、未評価・取得失敗・データ不足の区別も弱い。
- 上位3通貨欄の3位が、条件を満たす表示データが2件以下のとき空欄になる。
- 現在のScoreが各ロジックのGate充足率の単純平均で、売買ロジック固有のScoreと誤認しやすく、値も低く見える。

成功条件は、全HPの現在ロジック表示がV4契約と整合し、実際のV4 runtimeが未稼働・stale・SHA不一致の場合はその事実を明示すること。リアルタイム画面では、全監視範囲の評価対象・Score・順位対象外理由を確認でき、V12 V4専用および各strategy専用の上位3枠を常に視認できること。表示Score、順位、候補は発注可否を変えない。

## 2. 確認済みの現状と根本原因

### V4とProductionの区別

- V4候補の正式名は `V2_M150_D05_CORE_NATIVE`、41 routes。
- 手元の最終V4 handoff (`f569004917ec3c3547b7d7da3478d57323af06ab`) は、候補SHA `447205ee22ab64d2d0013922eeccfd4a1e14a72f`、Production/current `ce1edeead8d0f9e5d88e829d415057117502a335`、`BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE` と記録している。これはhandoff時点の記録であり、今回の作業時点のVPS実測値とはみなさない。
- GitHubへの接続はこの設計作成時に失敗しており、remote HEADおよびVPSの現状は再確認できていない。実装時に正本と現状態を再確認する。
- V4のread-only decision snapshot型は `lib/v12-v4-live-candidate-builder.ts` の `v12-v4-live-decision/v1`。V4 health heartbeatは別系統 (`/var/lib/disdex/v12-v4/heartbeat.json`) で、release SHA・mode・orderEnabled等を持つ。どちらも実際のV4 LIVE認証を単独で証明するものではない。
- handoffが示すreal-venue lifecycle証明不足、operator gate、V4の稼働状態をHP改修によって迂回・代替しない。

### HPのV12表示

現行HPソースは、旧 `V12 X1.00 ALL Top2` の固定説明・`V12_X1.00_ALL` unit ID・旧snapshot/state pathを多数参照している。V12決定状況APIも旧decision snapshotを読む設計で、V4の41 routeやV4 heartbeatを表示モデルに接続していない。単語置換だけでは、旧V12の決定をV4のものとして表示する危険がある。

### リアルタイムScoreと3位欠落

- `lib/server/realtime-ranking-observability.ts` の `make()` は、各strategy rowに `gateScore()` を適用する。
- `lib/realtime-ranking.ts` の `gateScore()` は、ロジック間で異なる数・意味のsignal Gateを同じ重さで平均し、`progress` がないNO Gateを0として扱う。これはstrategy native scoreや発火確率ではない。Q102等のnative metricも、現在はexecution kindとして追加されるため共通Scoreに含まれない。
- V12行は旧snapshotの `d.candidates` から作られ、全V4 route×symbolの評価一覧ではない。sourceの候補配列に出ない通貨は、score 0と区別して行自体がない場合がある。
- `topRankedCandidates()` は `score > 0` かつexecution blockなしのrowだけを最大3件選ぶ。`RealtimeRankingBoard.tsx` は返った件数だけ描画し、3件未満時のplaceholderがない。そのため3位が空欄になる。ロジック別複数rowがあるため、現状は「3通貨」ではなく重複symbolが上位枠を占める可能性もある。

## 3. 採用設計

### 3.1 V4をHPの現在ターゲット契約にする

HP内の現行V12説明は `V12 V4 / V2_M150_D05_CORE_NATIVE / 41 routes` を基準に統一する。ただし「採用仕様・表示対象」と「実際にVPSで動作中のrunner」は別の状態として保持する。

サーバー側にread-onlyのV4 view modelを設け、少なくとも次を一か所で解決して各ページへ配る。

- target architecture / policy ID / route count
- production current SHA、V4 release SHA、V4 heartbeat SHA
- V12 primary modeと実際のV4 service状態（取得可能な正規monitor情報）
- heartbeat・decision snapshotのtimestampとfreshness
- V4 candidate/filtered route一覧、特徴値、候補理由、`orderEnabled`、mutation indicator
- overall display state: `LIVE_VERIFIED` / `STAGED_NOT_LIVE` / `SHADOW` / `STALE` / `SHA_MISMATCH` / `UNAVAILABLE` 等

`LIVE_VERIFIED` は、V4 primary mode、正規service/monitor、current release SHA、heartbeat SHAが一致し、必要なfreshness/health条件も満たす場合に限る。UIの文字列や静的configだけからLIVEを推定しない。

V4がまだcurrentでない場合、HPはV4を「V4仕様 / 未稼働またはStage」と明示し、旧runnerが実際に存在すれば「旧V12 runtime」と分けて表示する。旧V12のsnapshotをV4 decisionとして再利用しない。V4データがない場合にUI側で売買理由を再計算しない。

### 3.2 全ページと履歴の扱い

現行V12契約を掲示する共通箇所を同じview modelへ接続する。対象は少なくとも、ホーム、共有のProduction banner / runtime badge / sidebar、positions dashboard、判定状況トップおよびV12詳細、realtime ranking、performance/logic説明、V12固有の履歴表示・APIである。実装時に `app/`, `components/`, `lib/server/` の全V12参照を再走査し、現在契約表示とhistorical lineageに分類する。

過去取引・過去BT・監査eventのstrategy IDや説明をV4へ遡及変換しない。V4以降の新しい実取引だけを、実際のruntime/ledger strategy IDに従ってV4として表示する。Shadow/model rowは必ずSHADOW表記し、実取引履歴へ混在させない。

### 3.3 リアルタイム対象通貨・V4 route coverage

V4 decision sourceを中心に、HPは以下のcoverageを返す。

- expected symbol / route universe
- 実際に評価されたroute-symbol行
- `CANDIDATE`、`NO_SIGNAL`、`FILTERED`、`NOT_EVALUATED`、`STALE`、`SOURCE_ERROR` の状態と正確な理由
- fresh numeric score/featureが存在する行数、順位対象数、順位対象外数

V4 sourceが出力していないrowを、UIが勝手に `NO_SIGNAL` と分類しない。評価できていないものは `NOT_EVALUATED` または `SOURCE_ERROR` とする。必要な全41 routeの診断出力がcanonical evaluatorから得られない場合は、その未評価数を隠さず表示する。

全rowは、freshなnumeric scoreが順位条件を満たすかに関係なく一覧に保持する。数値が存在すれば順位対象外でもScoreを表示する。scoreがないときは0に変換せず、`N/A` と不足理由を表示する。

### 3.4 Scoreの意味と改善

現在の共通gate平均は実際のV4 native scoreではないため、主Scoreとしての誤表示をやめる。

- runner/APIが発行したstrategy-native scoreがある場合は、値・単位・source timestampを保持して表示する。
- V4の現canonical candidateにはroute rankとfeature vectorがあるが、handoff上のroute priorityはhindsight leakage/外部Y06懸念を含み、単純な「信頼度Score」へ読み替えない。route rank、route、特徴値、eligibilityを別項目で表示する。
- 現行gate平均を残す場合は `Gate充足度` と明記し、Signal Score、成功確率、期待利益とは表示しない。
- Scoreを高く見せるためだけの固定加算・乗算、route rankからの恣意的換算、stale値の再利用は禁止する。native scoreが存在しないロジックは、その旨とgate状態を示す。
- 異なる尺度間で数値比較ができると証明されない限り、一つの数値へ無理に統合しない。realtimeの順位ソースとscore意味を画面に明記する。

したがって本設計での「低すぎるScoreの改善」は、無根拠な数字の引き上げではなく、source欠落による未表示を減らし、誤ったgate平均を実スコアと誤認させず、各native metricを適切な尺度で見せることを意味する。実装前にどのrunnerが真のnative numeric scoreを供給するかをAPI別に確認し、供給元のないscoreは作らない。

### 3.5 上位3通貨表示

順位はstrategyごとの独立したnamespaceで扱う。異なるstrategyのnative scoreやGate構成を混ぜて、単一の「全体上位3」を作らない。

- V12 V4には専用の「V12 V4 観測上位3」枠を設ける。current cycleの因果的なV4 evaluatorが実際に出力するrankを使う。research専用の固定priority、将来情報を使う疑いのあるrank、静的な研究artifactの順序はLIVE観測順位へ流用しない。同順位時のtie-breakはsymbol、route IDの固定順とする。許可できるruntime-safe rankがないcycleでは推測せず、3枠を「順位データ未取得」で埋める。
- 他strategyの順位表示もstrategyごとに分離し、そのstrategy自身のnative ranking contractを使う。native rankがないstrategyは候補一覧とscoreを表示するが、根拠のない順位は付けない。
- 各ranking namespaceでsymbol重複なしの3枠を常時表示する。同一symbolに複数routeがある場合はcanonical evaluator上の最上位routeを表示し、他routeは展開詳細で閲覧可能にする。
- freshなrankable symbolが3未満なら残り枠を「候補なし」「順位データ未取得」「stale」等、実際の状態で埋める。0-scoreやstale rowを3位へ昇格して見せない。
- execution blockのある上位symbolは観測順位から隠さず、`発注不可`とblock理由を併記する。観測順位は発注可能性を意味しない。V4がStage/Shadow/未認証なら、カード全体に同状態を明示する。
- native rankとnative scoreが別概念なら混同しない。見出しに順位sourceを示し、rankがscore順を意味しない場合は「route priority順」等と表記する。

既存の全strategy混合トップ欄を残す場合、共通尺度の比較妥当性を独立に証明した指標がない限り順位機能を付与しない。必要なら「全logic観測一覧」に変更し、strategy別rank/scoreを保持する。全体横断の単一Top3は、明示的な共通ranking contractと回帰テストが別途定義・承認されるまで対象外とする。

### 3.6 Error / fail-closed表示

V4 schema不一致、source file欠落、安全でないfile、release SHA不一致、heartbeat stale、decision batch incompleteは`LIVE`扱いせず、該当状態を表示する。失敗時に旧V12 snapshotやキャッシュscoreへsilent fallbackしない。HTTP/APIエラーでは最新scoreをfreshなものとして順位計算に使わない。

この統合はHPのread-only表示であり、Runner、systemd、operator artifact、Kill Switch、注文APIを呼ばない。全APIは`readOnly=true`および`tradingMutation=0`を維持する。

## 4. 非対象

- V12 V4の認証・operator activation・Production cutover・注文可能化
- 41 routeのentry/exit/sizing/GrossやShared Riskの変更
- PENGU/Q102/V52/FET/HYPE/Idle等のstrategy条件変更
- score表示のための注文・cancel・position mutation
- 取引履歴や過去のstrategy attributionの書換え
- Vercel利用。HPはAGENTS.mdに従いXServer VPSの既存HP-only deployment経路を使う。

## 5. 検証・受け入れ基準

### Contract / API

- V4 statusはexact current/release/heartbeat SHAとprimary-modeを検証し、不一致・stale・未稼働をLIVE表示しない。
- V4 snapshotが旧V12 snapshotと混同されない。41 route coverage counterはsource実態と一致し、未評価件数を明示する。
- APIとHPはread-only、注文・cancel・建玉変更0。
- historical V12 trade/eventのID・source・表示labelが変化しない。

### Realtime ranking

- scoreがあるrank-ineligible rowも数値を保持して表示し、scoreなし・0・staleを別扱いする。
- V12 V4およびnative rankを持つstrategyの各ranking namespaceでtop slotsは3個かつsymbol distinct。3件未満時はplaceholderが表示され、stale/未評価/research-only priorityを実順位へ混入させない。
- execution-blocked candidateも観測順位とblock状態を併記し、発注可否と混同しない。
- native scoreとGate充足度のラベル・値・sourceが正しい。固定倍率の水増しがない。
- desktop/mobile両方で全Score、rank、理由が崩れず読める。
- 30秒更新、効果音・順位アニメーション、既存の順位対象外score表示を回帰させない。

### 全体

- HP内のcurrent V12契約参照を全件棚卸しし、現在表示とhistorical lineageを分類する。
- UI contract / realtime ranking / decision API tests、TypeScript typecheck、production buildがPASS。
- GitHub Actionsで実job successを確認し、No jobs/skipped/cancelledを成功扱いしない。
- XServerのHP-only経路で公開後、全ページのHTTP/表示/APIとmobile/desktopを確認。Trading SHA、runner PID/restart、Aster stateが変更されていないことを検証する。

## 6. デプロイ境界とロールバック

実装承認後もUI-only branch / releaseを使い、trading release/current、Trading systemd、operator activation artifactには触れない。deploy前後でTrading SHAとrunner状態が不変であることを確認する。HPのAPI契約や表示に問題があれば、UI-only releaseを直前のUI releaseへ戻し、Trading runtimeには一切rollback操作を行わない。

## 7. 実装時の保留確認

この設計書はローカルの保存済みhandoffとUI sourceから作成した。GitHub remote HEAD、最新VPS runtime/UI release、現在のV4 service stateはネットワーク制限により今回再確認できていない。実装計画に入る前、および公開直前に一次ソースとして読み取り専用で再確認する。
