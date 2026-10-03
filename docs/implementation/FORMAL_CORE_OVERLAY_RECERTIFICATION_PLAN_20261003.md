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
