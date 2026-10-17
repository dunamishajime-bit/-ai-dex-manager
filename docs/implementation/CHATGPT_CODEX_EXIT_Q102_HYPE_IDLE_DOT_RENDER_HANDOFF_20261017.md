# Codex正式引継ぎ: Q102・HYPE・Idle DOT/RENDER DD/出口改善（2026-10-17）

STATUS: RESEARCH_CANDIDATE_READY_FOR_CODEX_IMPLEMENTATION_REQUEST — NOT LIVE.

Repository: dunamishajime-bit/-ai-dex-manager
Branch: research/q102-hype-idle-trail-handoff-20261017
研究branchの基点SHA: 9c03bb90841e4fb9fe62186940c62d3fcedabac4
期間: 2025-08-10〜2026-08-10。初期1万円、追加入金なし、複利。8ロジック統合／共有Gross・発注優先順位・同時ポジション・数量検証。10bpsと30bpsで確認。

## 採用候補（実装依頼対象の5項目）

| ID | 策略・銘柄 | 変更 |
|---|---|---|
| 1 | Q102 | 確定5m足で価格有利+2%を観測後、建値+0.5%の利益を確保するresident保護STOPの候補。LONG/SHORT対応 |
| 2 | HYPE_LONG | 口座損失2%相当のhard protective STOP。HYPE75入口は維持 |
| 3 | Idle DOTUSDT | 受理Gross上限0.25x |
| 4 | Idle RENDERUSDT | 受理Gross上限0.25x |
| 5 | Idle DOT/RENDER | 価格利益+3%達成で追走発動、以後5分足確定終値で更新した最高価格利益率から1.5パーセントポイント逆行するとSTOP。LONG/SHORT対応。その他Idleは変更なし |

Q102/HYPEは価格の%と口座資産リスク%を混同しない。Gross 0.25x時の価格+3%は口座理論P&L約+0.75%（fee前）。PENGU・その他ロジックは今回の変更対象外。

## 厳密な比較BT（口座資産額は過去モデル値で保証ではない）

| 8ロジック統合条件 | 10bps最終資産 | MTM最大DD | 取引件数 | 30bps最終資産 | MTM最大DD | 取引件数 |
|---|---:|---:|---:|---:|---:|---:|
| 原研究モデル（出口改善前） | ¥291,326,103 | -20.4200% | 1222 | ¥174,749,524 | -18.3888% | 1218 |
| 4変更（Q102/HYPE+DOT・RENDER0.25x） | ¥218,549,884 | -15.6282% | 1306 | ¥118,230,537 | -16.8085% | 1305 |
| **5変更（+両銘柄の追走3%/1.5pp）** | **¥222,818,967** | **-15.6206%** | **1310** | **¥124,289,207** | **-16.7878%** | **1307** |

5変更: 10bps PF=3.4588 勝率=72.366% 全Idle最大単発損失=-2.671%。
30bps PF=3.0786 勝率=69.549% 全Idle最大単発損失=-2.721%。
独立会計照合PASS。実受理GrossのDOT・RENDERは<=0.25x。追走の12研究ケース実行成功。

## 「DDが約5%下がった」の解釈と注意

原研究モデルからのDD差分は10bps **+4.7994パーセントポイント**、30bps **+1.6010ポイント**。10bpsでは約4.8ポイント改善したが、30bpsでは約1.6ポイント。
直前の4変更と比較した追走STOP単独のDD改善は10bps **+0.0076ポイント**、30bps **+0.0207ポイント**に留まる。利益追走だけでDDが5ポイント改善したわけではない。
原研究モデルに比べ最終資産は10bps ¥-68,507,136、30bps ¥-50,460,318。DD低減とリターンのトレードオフ。
**DD15%以下は未達。** 再実行は5m Binance Vision価格データを元のAster H1エントリー価格へスケーリングする研究モデル。実取引所発注・MarkPrice・板・partial fillの執行検証、独立holdoutは未実施。

## 実装前に確認すべき重要な前提

今回の基準BTは先行する研究overlayを3つ含む (combined_no_residual):
- Q102 family MR: H1 +3% → +1%利益保護
- V12 REC_G5_SLOW_TREND: H1 +2% → +0.5%保護
- V12 REC_X05_TIME_36H: H1 +2.5% → +1%保護

**この3変更は今回の5変更とは別。今のLIVEで実装済みと断定しないこと。** Codexは現Productionを一次ソースに現有実装を確認し、未実装のものを勝手に適用しない。必ず今のLIVE相当コードで今回の5変更だけのBTを再検証すること。

## Codex依頼時の必須作業

1. 現LIVE Production SHA / GitHub SHA / release & rollback / all Runner PID & restarts / 取引所positions & open orders / stop保護状態 / Shared Risk / Margin Guard / Kill Switch / account & shared rate locks / HP整合性をread-onlyで監査。
2. この研究branchをProductionへ直結せず、現LIVEから独立implementation branchを作る。研究コードは実装参考であり、runtimeコードではない。Q102/HYPE/Idleの既存入口・出口・STOP・HP差分を分析。
3. docs/implementation/EXIT_OVERLAY_Q102_HYPE_IDLE_CONTRACT_20261017.mdの5m因果契約で実装。LONG/SHORT、partial fill、stop replace race、通常EXIT、manual close、restart 復元と二重STOPを回帰テスト。PENGUを変更しない。
4. 現LIVEコードで原本BTと5変更BTを再現。10bps/30bps及びslippage厳格ケース、独立holdout、DD/winRate/PF/取引数/最悪単発損失を検証。
5. resident STOPはplaceでなく**取引所read-back**後だけ保護完了とする。Reduce-only、fill実数量、minNotional、gross reservation、kill switchを守り認証・operator artifactを作成。
6. ユーザーが別途Codexへ依頼するまで**LIVE切替・発注・HP更新・安全Gate解除は行わない**。

## 添付研究資料

- research/exit_overlays_20261017/evidence/RESEARCH_HANDOFF_MANIFEST.json
- research/exit_overlays_20261017/evidence/TRAILING_ALL_12_REPLAY_CASES.json
- research/exit_overlays_20261017/evidence/BASELINE_FOUR_CHANGE_REVALIDATION.json
- research/exit_overlays_20261017/evidence/SELECTED_POLICY_PROFILES.json
- research/exit_overlays_20261017/scripts/ 内のフル8ロジックBT / 5m / Gross source
- Static evidence verification: python research/exit_overlays_20261017/validate_handoff.py
- Full research replay: Windows PCのDesktop/idle-exit-deep-research-20261016 に元の frozen research source、M5 monthly ZIP、研究スクリプトとprofilesが必要。環境変数 DISDEX_V4_FROZEN_RESEARCH_ROOT に元のfreeze checkoutを指定して idle_dot_render_trail_compared_20261017.py を実行。大容量価格データ・secretはGitへ同梱しない。

研究handoffにより本番承認が成立するわけではない。
