# DisDex Runnerの既存保護EXITを止めない修正 — 2026-11-22

## ステータス

**研究/レビュー可能なRunnerコード修正済み。3件ともDraft PR、CI成功、運用VPS・master未反映。**
実注文、注文取消、STOP変更、建玉変更、Kill Switch変更は今回0件。HYPEの現行仕様・利益/損切り幅・Gross契約は変更なし。

## 監査と反映候補

| Runner | 現行候補ソースの不整合 | 変更/テスト | 状態 |
|---|---|---|---|
| V52 | 日次損失ラッチの `return` が `manage_positions` を飛ばす | [#590](https://github.com/dunamishajime-bit/-ai-dex-manager/pull/590)（V52 legacy tickを修正、6件模擬テストPASS） | Draft/CI PASS |
| PENGU | Q102 pending、他銘柄OPEN注文の全体ブロックが、既存PENGU建玉のSHORT V20損切りまで止め得る | [#591](https://github.com/dunamishajime-bit/-ai-dex-manager/pull/591)（entryとreduce-onlyの競合を分離、既存と新規テストPASS） | Draft/CI PASS |
| Q102 | 確定H1の履歴ロード失敗で、既存建玉のquote-based硬STOPとトレーリングが評価前に中断 | [#592](https://github.com/dunamishajime-bit/-ai-dex-manager/pull/592)（建玉中はH1依存判定を行わず既存STOP・最新quote依存EXITを継続、既存と新規テストPASS） | Draft/CI PASS |
| V4 | 正規Runnerの `reconcileEntriesAndProtection`、`verifyV4ResidentStops`、`processExitBars` が `assertEntrySafety` より先 | コード確認および既存4テストファイル、22件PASS | 変更不要と判断、BTの時刻差は別扱い |
| FET / IDLE | 対象BTの初期固定STOP前倒し矛盾なし | 元BT台帳にて検査。現行LIVEで全経路の一致未証明 | 本番変更なし |
| HYPE | 研究H48R4の48時間時刻決済と本番ATR STOPの同値性は未検証 | 現行仕様を維持 | 変更なし |

## 同時作業とリスク制御

- 3本ともCodexが進めているDraft候補 `fix/stable4-v52-q102-safety-repair-20261120-candidate` から分岐した別Draft PR。Codexの作業中ブランチ・masterは直接変更しない。
- V52は日次損失HOLD中に既存 `BASIS_STOP`、`MISSED_CHECKPOINT`、時間EXITを評価できるようにする。FLATTEN_MANAGEDは以前と同様に最優先。新規は禁止。
- PENGUはPENGUUSDTの不明注文との競合を引き続きmanual-reviewでブロック。resident STOP検証、持続台帳、数量・方向照合は変更しない。
- Q102はH1フィード障害時に欠損H1を捏造しない。履歴が必要な出口は発火しないが、取引所resident STOP・有効quoteベースの既存損切りと共有リスク縮小は維持。
- 既存STOP保護を削除したり、損切り幅を研究結果だけで引き下げたりしない。LIVEに載せる前に候補固定SHAと実稼働VPS SHA、保有建玉、実注文STOP数量・方向・発注時刻、CI、Ownerの正式認証を突き合わせる。
- プロセス生存確認と実注文の許可判断は分離し、Entry-only HOLDが既存建玉のrisk-reducing EXITを止めないことをテストする。

## 対象BTとの関係

[STABLE4_STOP_EXEC_AUDIT_20261121.md](STABLE4_STOP_EXEC_AUDIT_20261121.md) のGross4.25ケースで、モデルの初期STOPより後で決済した21件（V4 14件/PENGU5件/Q102 2件）およびV52遅延7件を確認。これらは研究BTのモデル内の不整合であり**LIVEの取引所STOP失敗を証明するデータではない**。

研究BTで5分足の初期STOPを先行させて再試行すると対象時刻差は0件になるが、DDは10bps 21.64%、30bps 22.35%で、DD20%以下にはまだ届かない。V52既存EXITの独立性を同時に加えるとDDは10bps 24.84%、30bps 21.34%。これも本番導入候補ではない。

## 完了検証

1. V52 Python AST隔離実行：6件PASS。
2. PENGU TypeScript隔離実行：新規 entry/exit conflictテストPASS + 既存V2自己検査PASS。
3. Q102 TypeScript隔離実行：H1欠損中の既存ポジションをreduce-only閉鎖する合成テストPASS + 既存Q102自己検査PASS。
4. V4テスト：`v12-v4-resident-stop-owners` 1件、`stop-fill-cycle` 1件、`recoverable-exit-feed-gap` 3件、`runner-engine` 17件、**計22件PASS**。
5. GitHub Actions: #590 PENGU CI 1件SUCCESS、#591 V12 X1/PENGU V20/PENGU CI 3件SUCCESS、#592 Q102 adopted/PENGU CI 2件SUCCESS（当該SHAの取得できたRun）。
6. すべて所有PCの隔離worktree/sparse cloneでテスト。取引所への通信・実注文・STOP取消・建玉変更・本番再起動は行っていない。

## 残作業／正式な導入条件

- 現行ProductionのRunner固定SHA、取引所STOP・残数量・取引履歴の**読み取り専用監査**を実施し、本番コードとの適用範囲を確定。
- Codex候補（#519）と3件の差分を競合なく統合するレビュー/CI。研究Gate・HYPE変更を混ぜない。
- STOP再実行データの残りQ102 5分足欠損・PENGU SHORT V20未採用ケース・HYPE正規ATR STOPの経済同値性を解消。
- 独立BTで10bps/30bpsそれぞれ最大DD、勝率、利益、尾部損失を検証。最大DD20%以下は未達のため、3件のコード修正だけでDDを改善できたと断定しない。
- Owner承認→GitHub Actions正式リリース以外からのLIVE更新は行わない。

**状態：RUNNER_CODE_PATCHED / OFFLINE_TEST_PASS / CI_PASS / DRAFT_PR / LIVE_UNCHANGED / PROD_SHA_AND_ORDER_EVIDENCE_REQUIRED.**
