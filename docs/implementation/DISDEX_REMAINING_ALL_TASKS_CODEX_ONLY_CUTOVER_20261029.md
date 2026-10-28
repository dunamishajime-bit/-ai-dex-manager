# DisDex / Codex 最終反映だけの引継ぎ・残余検証 2026-10-29

**Separate from PR #295.** 本文はCodexの既存本番切替手順を
変更・取消しするものではない。安全な候補コードと現実の残存認証を明確にする。

- Follow-up Draft PR: #296, branch research/remaining-hype-avax-priority-cert-20261029
- Latest source candidate: see GitHub PR #296 HEAD; never deploy this research branch without exact SHA, CI, venue, and 10/30bps economic gates
- PR #295 merged by Codex into fix/v4-shared-stop-owner-multisha-20261028
- PR #296 base was explicitly retargeted to this Codex post-merge branch
- Source-only merger dry-run conflict screen: git merge-tree exit0
- PR #296 modifies no LIVE service, account, order, resident STOP, kill switch, Shared Daily Risk, or HP

## A. ソース実装とテスト完了済みのタスク

1. HYPE旧承認済み HYPE75 M5 : BTC3h <= +0.6%、HYPE-BTC3h >= +2.0pp、最初から-1%1h/MFE<+0.3%、+3%アーム後 +1.5%保護。欠損・ギャップ・未確定M5はFail Closed。Node24モック15件PASS。
2. Native BTC/HYPE M5コレクター: read-only２GET/呼出し、429時再試行せずfail closed、注文0。5件PASS。現TRENDのLIVE runnerとは未接続。
3. HYPE M5 snapshot 因果Replay CLI: JSON出力し注文0。独立Synthetic replay PASS。
4. AVAX初回-3.5%/2h sticky watchと-5% hard STOPの旧native８ロジックBT結果を原本台帳SHA256と10bps/30bpsで検証し保存。18件で追加出口発火０の事実に注意。3件PASS。タイマーソース修正そのものはPR#295。
5. FET Coreの不要全決済: lib/disdex-strict-portfolio-planner.tsのCore入場を空きCrypto/Total/Strategy Grossがゼロとなり、FET譲渡で実際にエントリー可能な場合に限った。少しでもGross残余があれば先にそれを使用。余力がないが譲渡しても不可能ならFET建玉・STOPを保持。32件 source-only isolated PASS。
6. V52 Coreの不要全決済: scripts/disdex_v52_aster_only_live_engine.pyでIDLE_RESIDUAL、FET、Q102、V12、HYPE_ZECの各優先譲渡前に最新取引所のGross/予約額を再確認。前段の譲渡で余力ができたら後段STOPへ触らない。stock-cap違反をCrypto建玉決済で解消しようとしない。予約余力が一部あるだけなら他建玉を決済せず不足としてBLOCK。注文モック6件PASS、V52 native self-test PASS、隔離全体TypeScript typecheck PASS。
7. HYPE/ZEC sidecar譲渡の共有Gross invalid/NaN/Infinity/負数/未知notionalを根拠とする資金解放は禁止。18負境界テスト。PR #296 SOURCE-only。
8. Shared API競合とV4/Q102 STOP所有元: PR#295でソースとCI済み、CodexのProduction認証と反映作業は別スコープ。PR#296からruntime writerを勝手に操作しない。

## B. 本番・経済認証として**未完成**の項目

1. 2025-08-10〜2026-08-10の新Q102 exact SHA、最新８ロジック10bps／30bps年間統合BT。Aster public-native H1 23 symbolsに対し181日warmup開始2025-02-10より早い足が取得できない８銘柄:
   ENAUSDT, FETUSDT, FILUSDT, JUPUSDT, LDOUSDT, RENDERUSDT, TAOUSDT, TIAUSDT。
   今回のAster取得範囲では最大の最初の足が2026-01-09 18:00 UTC。
   欠損なく全銘柄が存在する場合の最初の181日充足可能日時は2026-07-09 18:00 UTC（理論下限・連続性未証明）。原本・再計算・Fail Closed検証:
   docs/research/evidence/Q102_ASTER_NATIVE_H1_EARLIEST_23_SYMBOLS_20261028.json
   scripts/research/validate-q102-native-annual-coverage-20261029.py
   tests/test_q102_native_annual_coverage_gate_20261029.py。
   見つからない取引所の歴史を別取引所OHLCVで置き換えたものを正本経済BTと呼ばない。限定期間のモデルは別認証が必要。
2. 旧HYPE75とLIVE HYPE TREND(H1 EMA12/48/240+breakout)は別エントリー戦略。純粋M5契約は作成したが、LIVE入口・出口・状態永続MFE・Venue STOPと統合するには最新８ロジック10/30bps比較と承認が必要。今のLIVEへ配線・有効化していない。
3. FETとV52優先Grossルールの変更は実約定配分や損益を変える。ソーステストがPASSでも市場データに基づく現行Q102込み統合経済BTの代わりにはならない。経済証拠がない状態でこのPRをLIVEにしない。
4. CodexのPR#295マージと実際のサービス切替は別。最後に読み取り専用で観測したVPSは共通risk writer 7688ed7c…LIVEのまま、旧 resident-stop-observation.json で unprotectedCount=1、V4独立コンパニオンHEALTHY effectiveUnprotectedCount=0、daily risk sourceComplete=true、lossPct=0/7.5%。残存矛盾を正式に切替・署名付きvenuesで解決するのはCodex最終工程。
5. V52米国株市場中の実発火/exit、HYPE M5 live-stop、FETのCore全経路の署名付き実取引所リハーサル、HPログイン後全ページのsource一致、全Runner再起動・未確定注文・Gross reservation journalの同期は source unit test のみでは証明不可。

## C. Codexに追加する作業（最後の本番実装だけ）

- まず現行建玉・未約定STOP/TP、FET/Q102/V4等のrelease marker、特にQ102 owner SHAを全て署名付きGETで正本照合。
- PR#295の共通risk writerを安全ゲート成立後に別SHAで単独切替し、旧UNKNOWNを管理済みSTOPの証拠と一致させる。サービス二重起動・STOP削除・Kill Switch緩和は禁止。
- PR#296は未認証の発火・出口変更を含むため、source-only受領を優先し、上記経済BTと署名付きVenue認証が成立するまでは未マージDraftで保留。
- 市場や取引所履歴の不足が埋まらない場合は BLOCKED_EXACT_NATIVE_HISTORY と明示。無断で日付/資金/レバ/Gross/ルート/約定を変えてBT数値を作らない。
- Codex本人が最後のProduction反映をする。ChatGPTの研究側では注文・取消・STOP・ポジション・systemdを触らない。

STATUS: NON_LIVE_RESEARCH_SOURCE_COMPLETE_AND_TESTED; EXACT_ANNUAL_ECONOMIC_AND_SIGNED_VENUE_CERTIFICATION_PENDING; LIVE_CHANGE_ONLY_CODEX.


## Newly found FET / Q102 independent owner-SHA defect
The older Core FET preemption callers sometimes provided their own release
SHA or Q102 release SHA to readFetBrk48State. Correct source changes in
lib/fet-brk48-live-reduction.ts, lib/v12-strict-live-adapter.ts,
lib/pengu-dual-ls-v2-portfolio-runner.ts,
lib/disdex-quality102-causal-v1-runner.ts, and
scripts/disdex-fet-brk48-core-preempt.ts now REQUIRE BOTH explicit
FET_BRK48_RUNTIME_SHA and DISDEX_Q102_RUNTIME_SHA operator pins
before any FET reduce-only liquidation / protection cancellation.
These are different real owner commits; never substitute the caller's SHA.
The pins must be written as root-only independent operator evidence
only by Codex in the final authenticated deployment and match signed
venue state, source release markers and LIVE heartbeat.
Missing pin is a mandatory fail-closed status, not permission to relax
the operator/venue gate. Source tests 36 PASS, TS full typecheck PASS.


## HYPE75 exact historical 5m exit source corrected (RESEARCH ONLY)
Cross-check of the exact adopted 2026-10-22 reference corrected the M5
loss/stop semantics. The early -1% stop uses PRIOR MFE < +0.3% and the
current confirmed M5 OPEN/LOW. The completed M5 CLOSE >=+3% arms the
+1.5% floor on the next bar, whose OPEN/LOW may trigger it. Gap-through
reference prices use the actual open (no optimistic fill). Node24 19/19
unit tests PASS. This branch does not wire a HYPE TREND LIVE execution
route; exact current eight-runner economics and signed STOP lifecycles
remain mandatory before any activation.
