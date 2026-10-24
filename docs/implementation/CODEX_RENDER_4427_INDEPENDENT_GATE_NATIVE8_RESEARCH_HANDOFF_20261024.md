# RENDER独立SHORT Gate：Codex研究引継ぎ（2026-10-24）

**STATUS: RESEARCH ONLY / PRODUCTION・VPS・LIVE・実注文を変更しない**

対象：dunamishajime-bit/-ai-dex-manager、研究ブランチ research/render4427-independent-gates-full8-blocker-20261024（GitHubへPushしたHEADを確認すること）。一次証拠は docs/research/results/render-three-regime-20261024/RENDER_4427_INDEPENDENT_DYNAMIC_SCORE_FULL8_RESEARCH_DECISION_20261024.md、RENDER_4427_INDEPENDENT_SELL55_NATIVE8_CORE_GATE_REJECTION_PROOF_20261024.json、同ブランチの研究スクリプト・回帰テスト。

## 既知の確定問題

既存#4427と別の、OIが−0.2%に届かなくても出るSHORT独立入口を確定済みD1/H4/H1、M5売り比率、BTC乖離で生成済み。各Gateは過去に決済済みの90/180日シャドー勝率/PF/手数料後期待損益と現相場スコアで優先順位を決める。既存Gateには同点で安全ボーナスを与え、同一RENDER SHORTを二重発注しない。Binance公式BTC 2025年8月〜2026年8月の13ZIPを出版社SHA・CRCとも検証済み。

研究選択案（あくまで未採用）は2025年後半RENDER単独30bps：19件→25件、勝率52.63→56%、複利+2.660→+4.306%、決済DD−14.521→−13.151%。2026年1〜8月：41→44件、勝率78.05→79.55%、複利+36.510→+41.483%。ただし2026年2月の既知負けを見て売り比率55%を選んだため過学習リスクが非常に高い。

Native8には既存#4427の42候補を残し、2026年の独立Gate合格SHORT3件（UTC 05月27日21時・06月23日01時・06月25日07時）だけ追加して10bps/30bps各3回再生。3件全て両コスト・全再生で「REJECTED_PORTFOLIO / IDLE:CORE_SIGNAL_OR_POSITION」となり、Native8の資産、DD、取引数、PFは既存#4427と**完全同一**。原因は新Gateが既存IDLE core入口条件に通らず、独立した正式な候補Ownerになっていないこと。スコアが高いだけでは解決しない。

## Codexに依頼する研究

1. 新研究ブランチ上で、実行中・本番のGateを触らず、独立SHORTの正式なGate/Owner契約を追加する。既存IDLE Core入口ルートには旧Gateを維持し、独立ルートだけは証拠付きの独立Gate認証を経て、従来通り共有リスク/所有権/注文審査に入れる。一般的なGate無効化や強制発火はしない。
2. 旧Gateと新独立Gateが同じRENDER SHORT時刻で合格したら、**当該時刻以前に終わった取引の勝率・PF・純期待損益、足確定、売り圧・出来高、DDリスク**からスコア化。既存Gateへの保守的タイブレーク、1シンボル1建玉、選択理由・落選理由・検証時刻を永続台帳に記録する。未来情報や当該取引の事後勝敗は使わない。
3. Global Shared Risk、Margin Guard、Kill Switch、account lock、max gross、同一シンボル建玉とPending、Cooldown、LIVEのfail-closed、安全審査は一切緩めない。「CORE_SIGNAL_OR_POSITION」拒否の原因を根本区分けし、独立Gateの正式認定とグローバル安全条件の維持を両立する。
4. Native8の10bps/30bps各3回、全候補・実際の採用/拒否・資金競合・資金再配分・リスク・利益・最大MTM DD・勝率・取引数を再計算。既存8戦略と元#4427の経済台帳一致、追加研究Gateの独立採用件数、理由とSHAまで監査。元#4427と比べてNative8共通口座の利益/DDを悪化させるなら不採用とする。
5. 2025年のAster RENDER H1 markは未確証のため、同年のBinanceモデル利益をAster-native共通口座の確認済み結果と偽らない。AsterのM5実約定・Funding・stop/部分約定は別途不足証拠として残す。2026年8〜10月も既探索済みで未使用OOSではない。Forward Shadowを新規構築する。
6. 初期含み損STOPと利益保護は入口ファミリーごとに別に行い、勝ち玉を早期損切りしないか計測。採用前に段階的な統合BTと正式認証を要求する。
7. 研究成果をGitHubへコード・監査・回帰テスト・SHAと共にPushし、Productionを変えていないことを報告する。**LIVEは本依頼の対象外**。

失敗時の状態は BLOCKED_INDEPENDENT_OWNER_OR_VENUE_EVIDENCE と明示すること。独立Gateの意図は旧Gateのリスク停止を突破することではなく、別の入口契約を明示して同じ共有安全審査を受けること。
