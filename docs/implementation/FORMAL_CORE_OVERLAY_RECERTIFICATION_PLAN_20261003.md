# Formal Core / retained Overlay 再認証計画

仕様: 2026-10-03のユーザー依頼と追加承認。LIVE 53eeff54を変更せず、旧1275件は歴史的モデルとして固定保存し、現LIVEのownership Gateを適用した別Core基準からIdle/DOGE/AVAXを再検証する。

## Task 1: 原本・Core exact parity

- Desktop の原本は read-only。raw candidate SHA 35d5259e と正式台帳の SHA を検証。
- 原本研究ソースと FET dual-gate 後入力を固定して再実行。
- 1,275 trades / 2,588 decisions 全行を JSON 値で比較。改行や serialize format の差は byte parity と区別。
- expected: Final 1229065462.0472791 / PF 2.4887028036012624 / DD -0.21296368751349548。

## Task 2: LIVE-equivalence safety gate

- actual interval [entry, exit) の strategy 跨ぎ same-symbol occupancy を検査。
- 同時 exit→entry は許可。反対売買だけでなく同方向 ownership 二重化も検査。
- source SHA / input SHA / baseline semantic parity / ownership が一つでも不一致なら certification は BLOCKED。
- 実装前 RED、実装後 GREEN。全競合を保存し、最初の divergence を Production runner の guard と突合。

## Task 3: 統合・stress・認証 (Task 2 PASS が前提)

- Core / +Idle / +Idle+DOGE / +Idle+AVAX / +Idle+DOGE+AVAX を同一 allocator で再計算。
- historical accepted-intent overlay や将来損益による候補選別は禁止。
- 10bps formal、8/20/30bps stress、全台帳・資金イベント・monthly・gross・attribution・manifest を保存。
- exact runtime SHA / CI / fresh VPS read-only / state / protection が一致して初めて deploy/operator/LIVE/HP。

## Ruling

ユーザー承認により、旧1275件とのexact一致は歴史的再現に限定し、新LIVE-equivalent候補の認証条件から分離する。ownershipによる拒否以外にSizing/Signalをretuneしない。元原本エンジンは編集せずSHA固定の派生モジュールへadmission hookを追加する。

Task 3のデータ不足はhistorical timestamp membershipで埋めない。全closed-lifecycle candidateによる比較を実行できても、current-H1 baseline eligibility/pending/marginが証明されるまではDIAGNOSTICとして保存し、certification/operator/deployをしない。

## 2026-10-03 continuation: certification evidence gates

1. Official Aster listing metadata and boundary klines: completed; raw responses
   and source/signal ledger are in formal-venue-availability-20261003.
2. Overlay 8,784 × 7 source/signal ledger: completed, independently regenerated.
   This does not claim a full Core baseline decision ledger.
3. Full Core H1 decisions: COMPLETE at research SHA `0d21b21fff23d58001bcbe1e7f4377d1013fe304`.
   GitHub Actions run `37122391842` completed SUCCESS. Q102 exact full-observability
   replay completed 74/74 chunks with no failures; 8,784 decision hours,
   166,834 per-symbol rows, 372 SIGNAL, 77 CANDIDATE and 166,385 WAIT.
   V12/PENGU/FET scheduled decision ledgers and Q102 all-hour per-symbol
   ranking/selection are PASS. Archived Q102 fast-scan HIGH_VOL referenceTs
   differs from the full Production signal on 116 rows only by the explicitly
   inventoried prior-H1 data-cutoff vs decision-timestamp convention; selected
   signal keys and economic semantics match.
4. V52 full H1 decision layer: COMPLETE for the approved price-only backtest
   model only. 8,784 H1 rows; 649 expected scheduled windows all observed;
   98 SIGNAL, 546 WAIT, 5 SOURCE_ERROR, 0 missing scheduled windows.
   Historical LIVE spread/depth/filter/margin/fill parity is NOT implied.
5. Execution/margin historical parity: BLOCKED. Production order-path contract
   tests PASS, but the fixed release contains no point-in-time account
   availableBalance/equity/margin snapshots, historical symbol filters,
   account-specific 5x Cross read-back, pending/account-lock chronology,
   partial/unknown execution reconciliation, or resident-protection fill
   chronology. Current exchangeInfo and synthetic margin emulation are not
   substitutes for those historical primary inputs.
6. Re-run 20 cases and paired overlay attribution only after execution/margin
   historical evidence is proven. Decision-layer PASS alone does not authorize
   recertification.
7. Full Python discovery: Linux whole-suite CI PASS at the same research SHA,
   213/213 tests, FAIL 0 / ERROR 0 / SKIP 0.
8. No certificate/operator/Production/HP action until the remaining historical
   execution/margin evidence gate PASSes.

Ruling: actual Production feature functions consume d-1 through d-73. Only
pre-listing-history start-up failures become explicit NO_SIGNAL warmup; no
invented 74-bar gate may suppress accepted signals or mask volume failures.
Missing required post-listing bars/BTC remain SOURCE_ERROR. Cost if wrong:
classification remains blocked rather than silently certifying missing data.
