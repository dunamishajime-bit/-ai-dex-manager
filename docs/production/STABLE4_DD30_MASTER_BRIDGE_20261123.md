# STABLE4 DD30 — master起点のRoot/Owner control-plane統合プレビュー

## 背景と判断

2026-11-23、PR #596にあるDD30候補（SHA 179e3f4e50f86ca8ab60baadaba1a96ed4c914ee）は、現行master（SHA 1eeb864b7b8be2a0279be9ed60af1b9ad234d8ed）とソース系統が異なることが判明。masterには正規Root切替・Owner承認ワークフローがある一方、V4/PENGU/Q102/V52の主要Runner実装が欠ける。DD30候補は逆に正式control-planeを欠く。

**PR #596の盲目的マージ、旧承認の再利用、VPSへの直接配置は禁止。** 本ブランチはmasterを親に持ち、以下の読み取り専用pre-LIVE source統合プレビューを準備する。

- 実行・STOP保護ソースはPR #596の固定SHA 179e3f4eから取得。
- Root切替とOwner承認実装に対応する scripts/ops/deploy はmaster固定SHA 1eeb864bから取得。
- 正式GitHub Actions workflowはmaster側をSHA256で照合。候補workflowを優先して上書きしない。
- source内の重複パスは正式master control-planeを優先。
- V4 DD30とSTOP、V52/PENGU/Q102出口の必須文字列を照合し、全ファイルをSHA256マニフェスト化。
- アーカイブはmtime=0、名前・順序固定の再現可能なtar.gz。プレビューは正式なGit immutable release/Owner planではない。

## 再現コマンド

必要な両コミットがGitで取得できる状態で、以下を実行する。

python scripts/ops/deploy/stable4_dd30_master_bridge_preview.py --repo . --out-dir C:/tmp/disdex-stable4-dd30-composite-preview-20261123

python -m unittest -v tests/test_stable4_dd30_master_bridge_preview.py

出力：
- stable4-dd30-prelive-composite-179e3f4e50f8.tar.gz
- stable4-dd30-prelive-composite-manifest.json

SHA256付き内容台帳を同梱。旧c731/旧planに固定されたworkflowは引き続き正式切替に使用できないため、プレビューの契約はformalImmutableGitReleaseCommit=NOT_CREATED、formalApproval=NOT_ISSUED、productionInstalled=falseを強制する。

## Codexが継続すべき単一統合作業

1. このプレビューを監査し、**新しい単一のreview済みGit SHA**に実行ソースと現行control-planeを統合する。package/tsconfig/systemd/HP Owner API等の依存と後方互換性をテストする。
2. 旧c731＋旧Plan固定の正式workflowとOwner goal承認境界を、新SHA、新Operation/Scope/PlanとOwner署名で安全に更新する。旧DD21承認はDD30へ流用不可。単純なSHA文字列置換や認証回避は禁止。
3. Signed GET×3、GLOBAL Kill Switch、H48、Funding、Gross、Shared Risk7.5%、V4 DD30、PENGU17%、V52価格近似、全Runner readiness、監視UI releaseを確認。
4. Q102旧b8dの200/CHDIR、候補Margin Guard c731のスクリプト欠落と再起動、V4/FET failed、diagnostic V4 stale pinを正式Root修復経路で解消。
5. order-disabled monitor-onlyを先に切替、Runner固有の保護STOPを3周期監視し、必要な正式Owner承認後に初めて個別order-enableを行う。

元STABLE4のDD30研究BTの実現最大DDは10bps 31.9963%、30bps 31.6246%。DD30はV4新規注文のHOLD閾値であり口座損失を30%以内に保証しない。

研究ブランチ：research/stable4-dd30-sensitivity-20261123、SHA 73cd02c3。元PR #596のソース安全修正：V4 e788のSTOP、V52日次損失中の既存EXIT、PENGU foreign order中のreduce-only、Q102 H1欠損中のEXIT。

**本masterベースの成果物はPRE-LIVEレビュー用のみ。Production切替、VPS変更、Owner承認、実発注、STOP取消・再登録、Kill Switch解除は行わない。**
