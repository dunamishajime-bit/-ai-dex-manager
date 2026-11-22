# P107 STABLE4 現行固定SHA・部品単位の再現性監査（2026-11-23）

**結論：入口・モデル出口の検証は進展。ただし全Runnerの口座完全一致BTは未完了。正式判定：BLOCKED_NOT_FULL_PARITY。**

対象は 2025-10-01 00:00 UTC〜2026-10-01 00:00 UTC（終端除外）。10bps・30bps独立、初期1万円・複利、HYPE/IDLEの仮稼働条件の本番モデル再演を最終目標とする。下記の発火候補は口座約定ではない。

## 今回固定した再現検証

| 対象 | 固定SHA | 結果 | 確認したもの・未確認のもの |
|---|---|---|---|
| V4 | e788abc82e80f9fc7ab0e1ba83fdb8be267eb513 | 1,394/1,394 | ASTER H1の2時間グリッドから純粋ソース発火全件、銘柄・方向・ルート・時刻・rank・指紋全一致。ATR 1,394/1,394差0。M5四則131、H1四則176、通常出口1087の各モデル時刻・理由・価格が現行ピン関数で全一致。**DD21 HOLD・他Runner Gross・Shared Risk・約定・STOPは未検証** |
| Q102 | c7310d34ba1b6de07071d8883a2ed0de8dcce2a7 | 49 raw candidates | HIGH_VOL9＋S34対象11の入力20銘柄。1年の4Hグリッド2190のうち1691件データFail Closed、499件ソース評価、49入口候補、ソース例外0。プロセス実効Gross3.0x、注文許可false。以前のEnvironmentFile0.50xは実効値ではなく比較研究 |
| PENGU | 1657e173d250ad58f53e62f7bb0a3428fb405496 | 旧116→現行117 | LONG V64 25、SHORT V20 41、RECOVERY V8 51。1年間8759の毎時刻を直近1000または999本の完了済みASTER H1で原生ソース直接再計算：どちらも117、例外0、旧116は全件包含。追加SHORT V20 2025-10-10 06:00 UTC発火、次H1始値0.0301 USDT。旧116件は2025-09-24以降しかウォームアップせず、同条件で旧116を完全再現。追加候補の**注文可否・単独出口・口座BTは未検証** |
| HYPE | e0e4f1d8f22b62e9410188ef6e590a20e31f760f | 35 source candidates | 現行Native H1入口＋H48 Time Only境界35/35、欠測0。旧HYPE78候補はルート・履歴の異なる研究結果 |
| FET | 7688ed7c93a1918d8b44837339b7da5584a868f5 | 11/11 | PINソースのFET H1発火、入口参照価格・48h高値・出来高比・72hリターンまで旧候補11/11一致。入口候補であり、保有時のTrailing STOP・決済・再許可は未証明 |
| IDLE | 7688ed7c93a1918d8b44837339b7da5584a868f5 | 旧183→正しくは184候補 | 旧研究コードは74〜79本目で arr.slice(i-80,i) と負の開始位置を渡すため履歴不足と誤判定。現行ソースへ74本以上の実履歴を正しく渡すとJUP Short（2026-01-12 18:00 UTC）が1候補増加。旧挙動を模倣すると183/183、修正後は184候補、旧183の入口・特徴量は全部一致。署名済み約定ではない |
| V4 DD21 | e788abc82e80f9fc7ab0e1ba83fdb8be267eb513 | 5ケースPASS | maxDrawdownは口座の累積ピーク基準で最大値を保持し続ける。21%超のShared Reservation拒否は、残高が後に全回復しても自動再許可されない。BTだけの仮想解除は禁止 |

V4の条件付きモデル出口1,394/1,394の再計算が完全に一致しても、これは現物の署名済み約定1,394件の証明ではない。STOP・TP・reduce-onlyの約定確認、数量・手数料・Funding、他ロジックによる注文枠占有、同時Gross、日次損失7.5%、V4累積DD21%、共有GLOBAL HOLD・正式再許可を時系列で再演するまで成績は本番完全一致でない。

## 資料と再現性テスト

- [V4入口と全1,394件モデル出口、入力SHA256、再実行スクリプト](./v4_exact/README.md)
- [V4条件付きモデル再現判定JSON](./v4_exact/P107_V4_NATIVE_1394_ENTRY_ATR_EXIT_COMPONENT_VERDICT_20261123.json)
- [V4累積DD21%ロック試験](./v4_exact/P107_V4_NATIVE_DD21_PERMANENT_LATCH_TEST_20261123.json)
- [PENGU 117件のウォームアップ原因・原生再評価証跡](./pengu_exact/P107_PENGU_116_TO_117_EARLY_WARMUP_CORRECTION_VERDICT_20261123.json)
- [PENGU非破壊修正版入口候補117件JSONL](./pengu_exact/P107_PENGU_PIN_ASOF_117_RAW_ENTRY_CANDIDATES_20261123.jsonl)
- [Q102実プロセス設定と年間判定](./q102_native/P107_Q102_FULL_UNIVERSE_NATIVE_ENTRY_REPLAY_AND_RUNTIME_CORRECTION_20261123.md)
- [HYPE固定SHAの入口/H48](./hype_exact/README.md)
- [FET11完全一致・IDLE184修正版入口候補](./fet_idle_exact/P107_FET11_IDLE184_PINNED_SOURCE_CORRECTION_VERDICT_20261123.json)
- [FET・IDLEの再現スクリプトと回帰テスト](./fet_idle_exact/README.md)
- [過去旧研究BTの正式完全一致不合格](./P107_STABLE4_FULL_PARITY_VERDICT_20261122.md)

## 本番完全一致BTを阻む残りの条件

1. 現行固定SHAのPENGU/FET/IDLE/Q102/V52の全シグナルと個別のSTOP/TP/Partial/Exitを現実市場データで再演する。PENGUは117件の入口候補に基づき、発火後の建玉競合・冷却・実行確認を再計算する。
2. ASTERの公開H1にFET・LDO・RENDER等の初期履歴不足と、2025-09-13 BTCの公式不正OHLCがあり、サロゲート価格で黙って埋めて本番一致とはしない。V52のH1 basis proxy／missing executable bookを正式native模型と誤認しない。
3. 全Runnerの固定SHA、H48対象差、Shared Risk、crypto/stock/total Grossの実効契約、同時建玉、symbol ownership、V4 DD21% HOLDのラッチと再許可、当日資金計算、Funding、10/30bps別の全注文約定・拒否の時間順台帳をゼロから再計算する。旧研究の合算だけでは不可。
4. 再実行／人工相場／期間外評価の独立検証ができたものだけP107 PASS。次の順序は **P107 → P108（Binance native独立発火→ASTER M5確認）→ P109（Long/Short方向誤判定）→ P110（10/30bps・全口座・人工/OOS）**。

本番の変更0、実注文0、STOP操作0、Kill Switch解除0、権限変更0。研究専用GitHubブランチにのみ保存。
