# STABLE4 Q102公開データ・52件の再計算証跡（2026-11-17 JST）

## 成果（非本番・読取専用市場データ）

Owner PCの既存公的リクエスト計画 `public-bootstrap-requests-plan-20261117.json` SHA256 `5f00d58f092c279098984de273d8a19c107ac812d68b9afa2b650f3476486728` を元に、**VPSの固定SDK** `7688ed7c93a1918d8b44837339b7da5584a868f5` と共通APIレート予算 `/var/lib/disdex/shared/aster-rate-budget.json` を用いて、Aster公開市場データのGETのみを実施しました。

実行スクリプト：Git `scripts/stable4-q102-capture-bootstrap-public.mjs`、検証済みGit source `51a40e87f02690c0c4380b269635d61435b7dd5b`、collector SHA256 `d8d133010694d9df7364c0965994e0888257e4470f4c387a4313699762504370`。**ASTER_API_PRIVATE_KEYおよび口座情報は使用せず、注文/取消/建玉変更0件**。VPSのRoot/稼働Runner/STOP/Production状態は変更していません。

公開データは取引系とは別の隔離ディレクトリ `/var/tmp/disdex-stable4-q102-public-20261117-c53f` にRoot専用0700で保存。PCのプライベート作業領域にも7ファイルを転送し、VPSとのSHA256一致を**7/7**確認済み。生データはGitへPushしません。

| 銘柄 | 追加M5本数 | Funding本数 | SHA256 |
|---|---:|---:|---|
| APTUSDT | 2125 | 55 | `f43af7bb3b2e7985a2b183fa398cd5142512f26bddef3fd9ed3e6331048f2950` |
| AVAXUSDT | 2077 | 138 | `57492b8237484a5409609b5eb01e034a0a9210acb59f0f73a833e3310773482c` |
| DOGEUSDT | 0 | 10 | `33a855a0e1209d35ae775535300174c196c0a2bb5f78bb30ec3fad4afb10ebd5` |
| FETUSDT | 2125 | 124 | `4d55b8cec46c5244a7258be7d097fed7128e8eed20168f6da3061519089be09f` |
| FILUSDT | 0 | 9 | `6c16a38cf92293510b7226fc81c082bd1cdfcb6469438ffdc858bc8de139ed0a` |
| NEARUSDT | 0 | 6 | `566e18ad96eb86cce3dfb66dde0e7b5c069203898b782886bc693fe446e42346` |
| ONDOUSDT | 0 | 131 | `bcb771878bae7e82716634ae64d3ec771a289274401e6cbdad69bc0ceab23823` |

## Offline因果結果・元state保護

元のPrivate Q102 state SHA256 `a1a5bb448311631ff3b42a846e8e85c9434f2c93a4a677b1c114ec0f8a922067` をbyte-exactで**別ファイルへコピー**し、PCで `scripts/stable4-q102-bootstrap-outcomes.ts` を実行。元stateはハッシュ不変。

- もともとの **52 pending** は、再計算後 **47 completed + 5 explicitly unresolved + 0 matured pending** に分類。
- 未解決5件は **APT 3件 / FET 2件**、全て`M5_ZERO_TRADE_ENTRY_OPEN_MISMATCH`。価格を推測して補正したり、利益・勝率・訓練へ無断投入せず、明示的な未解決ラベルとして保持。
- AVAXの別系列：`avaxRows=31`、`avaxPending=4`。これは上記52件の復旧pendingとは別の継続検証対象。
- 新Private state SHA256 `f421304dca3d8855272c42fb0966db6a83dc98f0e97d0797f0bb23426eef8bb9`、bootstrap summary SHA256 `79760d3f924883afb5a84b44bc6f61498807fab6382e2fd1659acb712169e018`。
- 既存の`disdex_stable4_q102_bootstrap_seal.validate_candidate`で、source/plan/evidence全7件のハッシュ、state/receiptの全一致検査は**その当時の観測frontierとしてPASS**。これはOwner承認やRuntime導入許可ではありません。

## 残る重要な切替前ゲート

**本番時刻を使うと `Q102_BOOTSTRAP_OBSERVATION_FRONTIER_STALE` で正しくBLOCK。** 観測frontier `1794826800000`（UTC 2026-11-16 11:00）はVPS現在時刻より古く、全20銘柄の最新H1観測と追加pending結果の更新が必要。

また、旧Q102実稼働（`ef1ab178...`）、正式なsigned venue GETによるflatとSTOP証明、単一Writer/Native parser/rollbackのRoot信頼証明、候補immutable release、正規Owner plan/HP承認は引き続き未完了。OwnerのDD研究延期は本件の保護ゲート解除を意味しません。

**ステータス：PUBLIC_EVIDENCE_7_OF_7_CAPTURED; Q102_RECOVERY_47_COMPLETED_5_EXPLICIT_UNRESOLVED; CURRENT_HOUR_STALE; NEW_WRITER_NOT_ACTIVATED。**
