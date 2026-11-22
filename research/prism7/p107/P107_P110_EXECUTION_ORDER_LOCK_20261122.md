# P107→P108→P109→P110 研究の正式順序（2026-11-22）

## Ownerが指定した順番（変更しない）

1. **P107：STABLE4完全一致BT。** Production固定SHA、H48の実際の適用範囲、DD21% HOLDと復旧、Shared Risk Daily7.5%、Gross（Crypto3.0x/Stock1.5x/Total3.5x）、全Runnerの現行ENTRY/EXIT/STOP/Funding/部分決済/優先順位を監査。まず追加判定ゼロの基準BTにおいて、入口候補・許可/拒否・建玉・決済・NAV/DDの完全一致を明細単位で証明する。古いP92/P106の数値を現行STABLE4と呼ばない。
2. **P108：PENGU新ロジックで採用済みの方式を、他Runnerへ展開研究。** PENGUのBinance Native独立発火→ASTER確定M5確認→ASTER発注候補を維持し、V4・Q102・IDLE・HYPE・FET・補助ルートに対しても各Pinned元ENTRY式をBinance確定足で**独立再計算**する。旧P106のトレンド確認/減点だけを独立発火と称しない。約定/STOP/EXITの価格基準はASTER。V52は独立発火対象外、口座リスクには含める。
3. **P109：誤判定の分解。** 上昇・下降・レンジ・急反転でLong/Shortを分割し、Runner・route・symbol別に誤方向、反転、流動性、早期逆行、EXIT要因、失った勝ちを調べる。訓練/検証/未使用期間を分離し、過学習を検出する。
4. **P110：全口座BT。** 2025-10-01 00:00 UTC～2026-10-01 00:00 UTC（終了除外）、初期1万円・複利、10bps/30bps別に5m単位の全口座を再生。独立実期間・人工市場・walk-forward・100bps追加滑り・Funding・STOPギャップ・Gross・Shared Risk・DD21% HOLDと再許可・V52占有を再計算。DD20%以内、勝率、純利益、件数、PFと独立再現性が採用判定条件。

## P107実施済みと未解決

- P107監査コードと実行結果は同じ研究枝にPush済み。既存4個のSTABLE4/DD研究ケースはいずれもProduction完全一致を証明せず、P107_GATE_BLOCKED_RESEARCH_ONLY。
- うち一部の「STABLE4」研究ケースがStock Gross4.0x / Total Gross4.25xを記録し、現行想定の1.5x/3.5xと相違。Q102 HIGH_VOL欠落および66件Fail Closedの記載あり。
- P106再現ZIPを解析済み。内部JSONの binanceIndependentNativeEntryGeneratorReplayedForNonPENGU は false、sourceV4Q102OlderPinnedResearchNot20261122Stable4 は true。従ってP108も未実施。
- 現行Production実PIN全数の取得・注文明細単位の再現・基準BT完全一致は未完了。P107合格を偽装せず、P108/109/110の採否を先取りしない。
- 研究のみ。Production Runner/STOP/Order/Gross/Kill Switch/建玉/HPは一切変更しない。
