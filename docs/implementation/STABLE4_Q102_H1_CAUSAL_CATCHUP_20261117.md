# STABLE4 Q102公開H1補完・非本番の因果観測追従（2026-11-17 JST）

## 検証範囲

既存Q102候補の古い観測`1794826800000`から、**20銘柄×10時間＝200本**の確定1時間足を公共のAster `GET /fapi/v3/klines`のみで取得し、元の学習/ローリング入力を変更せず、Private PC上の新しいコピーへ接続しました。取引所の口座秘密鍵・アカウント情報は使用せず、発注・取消・建玉変更・systemd変更・Owner承認は0件です。

- 再利用可能な公開H1取得スクリプト：`scripts/stable4-q102-capture-h1-public.mjs`、Git blob SHA256 `b9b28e61f999ca6cffcc16d9fb7e8c5edb04b6d55ed424d6c8e428ace85327de`
- 因果観測更新スクリプト：`scripts/stable4-q102-advance-offline-h1.ts`、Git blob SHA256 `0f7a30672a062171c0f5f1eba05c1dd7e55061335315932aa79ead900b94257a`
- 固定SDK `7688ed7c93a1918d8b44837339b7da5584a868f5`、既存の共有API予算を使用、GETのみ許可。VPS隔離領域 `/var/tmp/disdex-stable4-q102-public-20261117-c53f/h1` は取引系から分離。
- 私有H1取得計画 SHA256 `a1e7969e94d5dbd4083af3593f0883fcea15f8ab4d4d2ef0426467f8b3e69156`
- 元のローリングH1 SHA256 `969626361eb892d281aec39b25d5374b5966ae23e28ddb646225181195b431d0`
- 20個の公開H1 JSONは、VPSからPCへ転送後**20/20ファイルのSHA256が一致**。時刻・OHLC・音量の条件を全部検査し、各20銘柄10本すべてが連続。
- 追加区間：`1794830400000` ～ `1794862800000`（UTC 2026-11-16 12:00～21:00開始足、すべて取得時にクローズ済み）。新しいローリングH1 SHA256：`61c0b317f284f54c48bd315a9305c5686192aa1e25bb01e2e747271658774671`。
- 元の1銘柄5400本の窓長を維持するため、増分10本を追加後、末尾5400本を保存。20銘柄のデータの未来足・穴埋め推測なし。元のローリングH1ファイルはSHA不変。

## Q102のPrivateコピー上での結果

既に取得済みの7銘柄のM5/Funding公開証拠から再計算した52件の状態（PrivateコピーSHA `f421304dca3d8855272c42fb0966db6a83dc98f0e97d0797f0bb23426eef8bb9`）をさらに独立コピーし、既存`Stable4Q102OnlineEngine.observe`を10周期だけ呼び出しました。

- **TypeScript全体の型検査PASS**、Q102増分観測のスクリプト実行PASS。
- 観測frontier：`1794826800000`→`1794862800000`（10時間）
- `recoveryCompleted=47`、`recoveryUnresolved=5`（APT3 / FET2）、`recoveryPending=0`のまま。
- 別系列AVAX：`avaxCompleted=31→33`、`avaxPending=4`。新規`evidenceRequestCount=0`。
- 新Private学習状態 SHA256：`725eea303f6065d1ee199c64ea45f6e6a3c4f4024eca627c077aa843ea4bd480`。
- **元の2026-11-16 stateと実稼働VPS Q102 stateには一切書き込んでいません。** 秘密のOHLC生データや私有学習stateをGitへ上げない。

## まだ本番へ切り替えない理由

今回の更新は非本番観測に限定。時刻は毎時進むため、正式な切替時に最新H1を再取得し`Q102_BOOTSTRAP_OBSERVATION_FRONTIER_STALE`を再検証する必要があります。52件中の未解決5件は捏造せず、学習対象から排除した状態を維持します。

**旧Q102 Writerはactive**。署名付き取引所GETで一時的に建玉0件/未約定0件を確認していても、それだけでWriterの停止や新bootstrapの正式許可にはなりません。Source-pinned native bootstrapのDRAFT_BLOCKED、旧Writer排他・Rollback、外部Root動的依存・immutable release/Owner認証が未成立です。研究BT最大DD20%受入はOwner指示で切替後へ延期していますが、この安全条件は延期しません。

**状態：Q102_H1_PUBLIC_CAUSAL_CATCHUP_PASS_NONPRODUCTION; LIVE_SWITCH_NOT_CERTIFIED。**
