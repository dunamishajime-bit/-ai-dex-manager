# STABLE4 正式切替 Codex 引継書（2026-11-23）

## 依頼と厳守事項

Owner最終決定（2026-11-23）：元STABLE4を優先し、V4新規注文DD停止基準を30%に採用変更する。新PENGU Binance独立発火・ASTER M5版およびP100ポイント制は混ぜない。元STABLE4 DD21%の研究結果は比較資料として保存する。

この候補ブランチの役割は、STOP・出口保護・Runner整合性の修正とテスト・読み取り専用VPS差分点検まで。正式切替、LIVE Order Enable、実発注、STOP取消・再登録、保有建玉の決済、GLOBAL HOLD/Kill Switch操作、Owner承認はすべてCodexへ引き継ぐ。現状では実行していない。

研究BT条件：2025-10-01 00:00 UTCから2026-10-01 00:00 UTC（終端除外）、初期資金1万円、複利、10/30bps、Crypto Gross3.0、Stock Gross4.0、Total Gross4.25、Shared Crypto日次損失7.5%。V4新規注文のDD停止基準のみ21%→30%とした。30%研究BTの全口座最大DDは10bps=31.9963%、30bps=31.6246%であり、DD30%以下は保証されない。旧21%研究BTの最大DD21.57%/22.28%も比較基準として残す。V52には歴史的H1約定価格近似が残る。

## DD30%のOwner変更：旧承認流用禁止

DD30%変更と実績DD約32%の証拠は docs/production/STABLE4_DD30_OWNER_ADOPTION_20261123.md を参照。V4 shared-reservations と生産認証の共通定数を0.30に変更、21%の古いOwner署名計画を再利用しない。現行GLOBAL HOLD、各Runner固有の保護、STOP、既存建玉管理、Owner正式LIVE承認の範囲は変えていない。新候補SHAを含む新しい正式Operator plan・HP承認が必要。

## GitHub pre-LIVE候補

作業ブランチ：prep/stable4-exit-integration-20261123
ベースSHA：c7310d34ba1b6de07071d8883a2ed0de8dcce2a7
V4保護ソース固定SHA：e788abc82e80f9fc7ab0e1ba83fdb8be267eb513

次の既存Draft PRの保護出口修正を統合した：
- PR #590 V52：戦略日次損失による新規HOLD中も、既存建玉のBASIS_STOP・TIME等の管理を止めない
- PR #591 PENGU：他銘柄のopen orderは新規を抑止するが、既存建玉のreduce-only EXITを妨げない。同一銘柄の競合は依然Fail Closed
- PR #592 Q102：H1履歴不通時も既存建玉の署名STOP・有効quoteベースのhard stop・trail・Shared Risk縮小を維持、新規はH1必須でFail Closed

さらに、VPSで固定済みV4 e788の入口から出口までの署名口座鮮度、resident STOP数量、外部成約照合、不要STOP退役証拠、exit feed再試行、部分約定後STOP増量、shared reservation返却などが旧STABLE4候補に欠落していたため、V4元ソースから3本体＋3ヘルパー＋7必要モジュール＋3回帰テストをSHA比較付きで統合。実VPSの既存保護ロジックより後退させていない。

主要監査ファイル：
- docs/production/stable4-vps-source-parity-audit-20261123.json：VPS各固定SHAの物理ファイルSHA256と候補比較
- docs/production/stable4-exit-safety-candidate-source-manifest-20261123.json：重要ソース16本のSHA256と選定条件・未完了ゲート
- scripts/ops/stable4_pre_live_exit_source_guard.py：未承認LIVE、未達の経済パリティ主張、ソース改ざんをFail Closed
- tests/test_stable4_pre_live_exit_source_guard.py：4種類のガード回帰
- .github/workflows/disdex-stable4-prelive-exit-protection-ci.yml：production権限を持たないoffline CI

ローカル検証実績：
- TypeScript全体 tsc --noEmit --pretty false PASS
- V4 STOP/exit/復元/署名台帳/保護：12ファイル、計63テストPASS
- V4 heartbeat/watchdog整合の既存テスト：23件PASS。VPS固定版のlastCompletedTickAt伝播を正確に検証するよう更新。
- V52 daily lossでも既存出口稼働：6ケースPASS
- PENGU exit vs foreign open order、既存PENGU selftest PASS
- Q102 H1欠損時exit、既存Q102 selftest PASS
- 重要ソース16本のSHA Source Guard PASS、改ざん／無断LIVE判定4ケースPASS
- GitHub Actions CIは候補Push後の検証結果を別途確認すること

## 実VPS読み取り専用監査（2026-11-23 JST）

VPSのrootによるsystemd状態・本番リリースファイルのSHA256を照合。VPSへの一切の書込み・サービス操作・発注・STOP操作なし。

系統／VPS SHA／実態：
- V4／e788abc8／failed。V4の採用候補は実VPSのSTOP本体を復元済
- PENGU／1657e173／inactive。新しい安全EXIT修正は実VPSより進んでいる
- Q102／c7310d34／active running。ただし新H1障害EXIT修正は実VPSにまだない
- V52／c7310d34／active running。ただし新daily-loss EXIT修正は実VPSにまだない
- FET／7688ed7c／failed。監査対象ソースは候補と一致
- HYPE／e0e4f1d8／inactive。監査対象ソースは候補と一致
- IDLE／7688ed7c／inactive。候補にRENDER追加出口/独立モデルの差分あり
- Shared Risk／2737c30e／active running
- Margin Guard／7688ed7c／active running

重大障害：旧Q102 b8d681f は再起動ループ、候補Margin Guard c7310d34も再起動ループ（監査時各13,994回／12,099回程度）。Runner watchdog failed。Q102/V52サービスがactiveでも注文許可やSTOP健全性の証明ではない。現在のGLOBAL HOLD/Owner consent/実注文許可状態は未検証。

## Codex限定の残りゲート

1. 新候補と現在master・VPS pin・他のCodexの並行PRを厳密比較。現行masterは候補と大幅に違い、STABLE4の実行ソースが多数存在しない。masterへ盲目的にマージやリベースをしない。
2. 元の研究STABLE4（DD21%）とOwner採用のV4 DD30%候補を区別し、各Runner入口・出口・STOP・H48・Funding・Gross・Shared Risk・V4 DD30・PENGU/Q102/IDLE/FET/HYPE/V52経済条件のルート別照合。完全一致できないV52板情報の欠損は明記。PENGU新モデルやP100は採用しない。V4 DD30%はOwnerの今回の明示指示として採用する。
3. FET stop floor、IDLE emergency stop、HYPE H48 TIME_ONLY除外、IDLE RENDER独立経路認証を各固定ソース・研究BT・採用済み仕様で個別監査。未採用の仮設STOP値を根拠なくLIVEへ加えない。
4. 実取引所の建玉、resident STOP、数量、未約定注文、署名約定、所有権、OPEN/PENDING/CLOSEDライフサイクル、Margin/Shared Riskを読み取り専用で照合。不確実な既存建玉に対して勝手なSTOP取消や新規注文は禁止。
5. systemd V4 failed、FET failed、PENGU/HYPE/IDLE inactive、Q102旧実体とCandidate Margin Guardの再起動ループ、watchdog failedを解消。Margin Guard/V52の依存先と他SHAとの二重Runnerを必ず確認（PR #586経緯）。
6. 合致した場合のみ、正式GitHub Actions CI、immutable release、Owner/HP承認のoperation-scope-SHA-PLAN、GLOBAL HOLD／Kill Switch条件、rollbackとサービス正当性を踏まえた正式切替。切替とLIVE発注可能化は今回のChatGPT作業では一切行わない。
7. 最終結果は新候補SHA、CI、VPS実効source SHA、systemd mode、operator承認、署名STOP照合を記録。Fail Closedを迂回しない。

結論：このブランチは「STOP・出口安全修正まで完了したpre-LIVEレビュー候補」。実際のSTABLE4稼働・LIVE発注準備認証・全口座経済一致は未完了であり、Codexの最終責任範囲。
