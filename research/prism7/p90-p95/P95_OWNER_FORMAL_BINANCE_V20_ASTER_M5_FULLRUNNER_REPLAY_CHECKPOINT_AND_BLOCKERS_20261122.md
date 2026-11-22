# P95｜Owner正式選択：Binance PENGU SHORT V20 → ASTER +確定5分足／全Runner再計算の到達点（2026-11-22）

## 進行状況

- **正式な採用方針はOwnerによって選定済**（戦略決定）。対象はPENGU SHORT V20のみ。Binance USD-MのNative元V20発火を独立の入口ソースとし、ASTERで完成5m足の下降判定スコアが2点以上ならASTERでショート。前H1の既確定価格のみ参照。元P73マクロによりGross 0.75／0.5／0、0.25禁止。ASTER側Native V20 STOP/出口を残す。PENGU LONG V64/Recovery V8と他Runnerは仕様変更なし。
- **P91実データ発火／M5判定台帳完了**。期間2025-10-01 00:00 UTC〜2026-10-01 00:00 UTC（終端除外）。Binance元V20自然発火41、元P73マクロ否決8、確定ASTER5m足スコア否決29、合格4。元ASTER自然V20は40件。この4件は発注ではなく市場データから再現したモデル入口候補。
- **P92統合シミュレーション隔離実行済**。元2026-11-09 STRICT_V2全Runner旧研究エンジンを完全複製し、アーカイブの30分刻み10/30bps実数結果と全指標一致。以後、比較ペアを同じ5分刻み、同じCrypto3.0/Stock1.5/Total3.5、研究V52 Gross1.5とし、PENGU V20元40候補→Binance＋確定5mの4候補にのみ置換。他Runner元発火候補は変更せず、時刻順にFunding、日次7.5%損失、Gross、既存シンボル占有、優先順位、残高、建玉、勝敗を全再計算。
- **P93結果**：
  - 10bps：全体最大DD 33.48%→24.62%（改善8.87ポイント）、1万円複利最終2,816,047円→1,807,111円（−35.83%）、モデル約定864→857件。
  - 30bps：最大DD 44.12%→29.95%（改善14.17ポイント）、最終850,333円→551,075円（−35.19%）、モデル約定864→857件。
  - PENGU V20実際にモデル採用された建玉：19→2件。元Long/Recovery候補は全76件そのまま。元V20の多くの勝ち候補も除外された可能性が高く、「DD減少は主に取引停止による」効果を区別する必要。
  - 変更前に拒否→変更後に採用された*元の他候補*19件：V4 8、PENGU他ルート5、Residual 3、IDLE 2、V52 1。逆に採用→新規拒否が9件（V4 8、PENGU 1）。旧V20の40件削除／新4件追加をこの19／9には含めていない。
  - 時刻別Equityの最初の差は2025-10-15T16:05:00Z。全105,120本の5分時刻が両BTで一致。
- **P94**：2方式×10/30bpsの約定・受付判定・Funding全CSVを可逆ZIP-base64化してGitHub研究ブランチに保存。105,120行×4条件のEquity原本は所有PCの隔離研究領域へ維持しSHA256を記録。研究ソース3版と再現スクリプトをGitHubへPush。

## 絶対に誤認してはいけない点

このP92は**2026-11-09旧研究エンジン**であり、2026-11-22の最新STABLE4／現行Production pinとは一致しない。特に**V4_MAX_DRAWDOWN_21PCT_HOLDゲートをモデル化していない**。したがって以前の別研究版に記録されたDD21%による673件の注文拒否が何件回復したかは、**未確認**であり「673件復活」等の主張を禁止。

P92の5分時刻刻みの残高マークは既に完成したASTERのH1終値ベース。STOPはM5高値タッチの研究モデルであり、本番約定履歴・板・実スリッページ・他Runner全STOP等は再現していない。HYPE/IDLE仮稼働、Q102/V4一部旧ルート、V52の研究的約定価格の制約がある。研究DD29.95%自体もOwner希望の最大DD20%条件を満たしておらず、**利益も約35%悪化**。今回のP92結果からLIVEの収益性・安全性を認証することはできない。

## 残務（重要順）

1. 本番と同じSTABLE4／各Runnerの最新実装SHA・H48・V52状態・共通DD21%HOLD復旧条件・Crypto3.0/Stock1.5/Total3.5・日次7.5%Gate・誤判定承認ルートを確認し、**変更前の完全一致再現BTを最初にPASS**させる。現行Codex作業中のworktree/PRへの競合書込を禁止。
2. P91の正式採用ソース（Binance H1発火+ASTER確定5mスコア+ASTER実約定模型）を本番と同じ5m/event-timeレベルの研究エンジンへ注入。PENGU V20以外の全Runner候補源を不変にし、リスクDD21%HOLD、発注Gross、Priority、シンボル競合、Funding、NativeSTOPの再計算。
3. 10bps/30bps＋買戻し追加100bpsのモデルで、新旧全Runnerの複利・最大M5 DD、勝率、モデル決済、STOP、V4/Q102/V52/HYPE/IDLE/FET別内訳、旧拒否→新採用と逆の差分ID、*DD21%ゲート由来の再許可件数*を証拠つき確定する。欠損データやExit未解決はFail-Closed。
4. DD≤20%および収益/勝率の悪化と過学習、別期間OOS、リアル発注時刻/板・スプレッド、署名付きSTOP・Funding・既存建玉引継ぎを検証。今回Ownerが選定した判定閾値は後出しで調整せず、変更したい場合は別の明示的研究版として分離。
5. SourceとModelがProductionに一致してリスクGateをPASSした場合のみ、候補コードを新規featureブランチのDraft PRでCIと実用監査。**本番・既存注文・STOP・Kill Switchは未変更。最終的なGitHub Actions→HP Owner認証→正式LIVEの手順は厳守**。研究承認は認証の迂回根拠にならない。

**状態：`OWNER_SELECTED; REAL_1Y_M5_GATE_REPLAY_DONE; OLDER_RUNNER_PAIRED_BT_DONE; LATEST_STABLE4_DD21_PARITY_NOT_DONE; LIVE_UNCHANGED`**
