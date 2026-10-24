# RENDER #4427 — 独立SHORT Gateの同一通貨建玉・12時間Cooldown・同時競合の追加監査（2026-10-24）

**STATUS: RESEARCH_ONLY / POSITION_COLLISION_CONFIRMED / OWNER_REGISTRATION_AND_NATIVE8_ECONOMICS_NOT YET CERTIFIED**

## 出典と再現性

- 親ブランチ `research/render4427-independent-gates-full8-blocker-20261024`、SHA `173659aef0e28826c4f1c2a2db47a5957eaa5085`。
- PC上の既存Native8 `C:\tmp\render-mtf-study-20261024\native8-indep-sell55-20261024` にある `candidate-decisions.jsonl` と `portfolio-trades.jsonl` を10/30bpsそれぞれ独立3再生、計6組突合。
- 追加検証コード：`C:\tmp\render-mtf-study-20261024\render_4427_independent_gate_native8_position_collision_audit_20261024.py`。機械台帳：`RENDER_4427_INDEPENDENT_GATE_NATIVE8_POSITION_COLLISION_AUDIT_20261024.json`（PC研究専用フォルダ）。
- 同一コスト3再生でポジション・候補スナップショットSHA256完全一致。10bps `1e8ff398798ba2f5f17e27dde9562fed3d422bf95c5d33d380c1219aa1c0109f`、30bps `045f6e932dbd9a133eb21d46831d7e352b7428c12d30a3cd3cfb0d8c391dfb39`。別プロセスで監査スクリプトを再実行して出力ファイルSHA256一致 `220b42919afa91aa1c8d1fce4ac2ee933332eacbcc136e69ec894191907ead6b`。

## 新たに確定した構造上の制約

| UTCシグナル時刻 | 10/30bpsとも既存RENDER建玉 | 12h再入禁止と同一通貨建玉がともにクリア | 10bps既存稼働gross合計 | 30bps既存稼働gross合計 | 同時刻の他候補 |
|---|---|---|---:|---:|---|
| 2026-05-27 21:00 | **あり**：IDLE_RENDER_RELATIVE_SHORT、22:00 UTC決済予定 | **いいえ** | 0.428483 | 0.575705 | 既存IDLE RENDER候補も同じ理由で拒否 |
| 2026-06-23 01:00 | なし | **はい** | 0.064414 | 0.109698 | Q102 FET SHORTが同時刻に採用 |
| 2026-06-25 07:00 | なし | **はい** | 0.831856 | 0.926647 | RESIDUAL AVAX候補が別のcore条件で拒否 |

3候補とも従来の `IDLE:CORE_SIGNAL_OR_POSITION` で拒否されることは既知。**新たに、5月27日の1件は単なる独立Owner未登録ではなく、同一RENDER SHORTの既存保有中という別の明確な禁止条件にも該当すると実台帳で確認した。** この候補を独立Route登録だけで通してはならない。研究用Owner実装後も同一通貨1建玉・重複禁止を維持する。

6月23日と25日の2件は、少なくとも同一RENDER建玉と12時間再入禁止に抵触しない。ただしこれだけでは発注許可ではない。6月23日はQ102同時採用による資金競合を、6月25日は4既存建玉と残余Gross・Margin・Shared Risk等を改めて審査する必要がある。両コストで同じ分類を確認。

## 判定と次タスク

- **新Gateの正式採用不可・LIVE化不可**。3件すべてを独立Owner登録だけで発注可能と扱うのは誤り。
- 次は研究専用の正規Owner/Routeを登録して、旧IDLE core入口だけを独立Gate契約で置換可能にする。ただし **5月27日は必ず同一RENDER建玉で拒否**、6月23日/25日は共通Shared Risk・Margin・Gross・Pending・account lock・Kill Switch・Cooldown等で最終判断する。
- 旧#4427・8ロジックNative8の10/30bps各3回を再生し、拒否理由、最終資産、最大MTM DD、PF、勝率、取引件数、競合を照合する。まだこの研究専用Ownerアダプターによる経済BTは行っていない。
- 2025 Aster RENDER H1 mark欠損、Aster実5分足約定・Funding未認証、過去期間はOOSでない点を維持。一次データがなければFail Closed。
- VPS・LIVE・Production・HP・実注文は変更していない。
