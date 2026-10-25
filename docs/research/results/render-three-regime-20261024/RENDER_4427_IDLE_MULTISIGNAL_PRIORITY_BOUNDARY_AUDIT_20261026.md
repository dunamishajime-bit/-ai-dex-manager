# RENDER #4427 — 既存IDLE複数候補の資金容量・優先順位境界監査（2026-10-26）

## 新規結論
固定Git一次コードの `lib/idle-priority-short-runner.ts` では、複数SHORT候補が存在すると、**全候補の要求Gross合計**を先にCrypto/Total双方の余力と比較し、不足すると `IDLE_MULTI_SIGNAL_CAPACITY_AMBIGUOUS` で**候補全体を見送る**。個々の候補が余力内であっても、当該判定では部分選択・残余Grossへの縮小・勝率/PFスコア順位による採択を行わない。合計が足りる場合は `signals` を順次 `enter` するが、当該選択区間に明示的なscore sortはない。

## 一次証拠
- 固定元Commit: `939b59da49ce7960485a2004b0068dc63417ae82`（このCommitの内容に限定した結論で、現行Production一致は未認証）。
- Runner: SHA256 `0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33`。該当行はおおむね 737–852、特に 831–851。
- Live admission: SHA256 `185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c`。
- Policy: SHA256 `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`。
- 既存RENDER routeはPolicyにあるが、独立研究Routeは登録されていない。対象RunnerのENTRY経路では研究用13 GateProof strict checkの呼出を確認できない。**ただしこれは既存IDLE Runnerに限定した静的観察であり、真正Native8 preallocation/owner-priority全体を監査した結果ではない。**

## 合成境界再現（経済BTではない）
Crypto/Total余力が各0.30xの仮定で、RENDER 0.25x単独は個別判定へ進む。一方、RENDER 0.25x + DOT 0.25x、またはRENDER 0.25x + JUP 1.0xの同時候補では、合計不足で**全候補を拒否**する。余力が合計以上なら合計判定を通過する。これはコードの容量分岐を再現した合成モデルで、実際の約定・GateProof・資金配分成績ではない。

## 再現性
GitHub上の監査スクリプト `scripts/dd-reduction/audit_render4427_idle_multisignal_priority_boundary_20261026.py` を所有PCからGitHub原本取得し、対象3ファイルの実バイトSHAを検証して、独立Python 2プロセスで実行。両方 exit=0、スクリプトSHA256 `7ee32d02a2d22f0a127c4d950bbc613e7595e46236f18dd6a69d222e0cb773e1`、canonical JSON SHA256 `32d1c971c5370e4676f3e01c10d9fb7e1e9d4ee217a68e7af87ea4ed1e72ced0` 一致。7合成ケースの期待分岐が一致。対象TypeScriptをimport/execせず、PCファイルの書込みなし。

## 研究上の含意と停止条件
新独立RENDER Routeを単純にPolicyへ追加しても、共通Owner/Route優先順位と厳格なGateProof・snapshot・dedupの認証にはならない。まず真正Native8側で、共通symbol/time/action予約のまま、候補別のscore/期待利益/リスク・残余Gross・13 GateProof・Owner選択理由を原子的に結合する経路を追跡する。既存同一通貨建玉、12h cooldown、Shared Risk、Gross、Margin Guard、Kill Switch、Pending、account lock、dedupを迂回しない。

**未認証:** 独立operator trust root、完全dynamic closure、正式Owner/Route、13 GateProof、実Native8経済BT、実Aster約定/Funding。LIVE/Production/HP/実注文/現行8ロジックは一切変更せず、経済BT・LIVE採用を行わない。既探索期間をOOSと呼ばない。
