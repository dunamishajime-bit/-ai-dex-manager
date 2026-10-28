# HYPE / AVAX / 優先発火・残作業のソース監査（2026-10-29）

STATUS: RESEARCH_CODE_TESTED / NOT A LIVE RELEASE.

## HYPE: 旧研究と現LIVEの非同一性

2026-10-22の8ロジック研究BTで採用したHYPE75条件:
BTC確定M5から算出した3h騰落率<=+0.6%、HYPE3h−BTC3h >=+2.0pp。
1h以降、最大含み益<+0.3%かつ-1.0%逆行で決済。
確定M5終値+3%到達後、含み益が+1.5%へ反落したら決済。

旧研究BTの参考値（当時のQ102・HYPE75・資金配分モデル）:
10bps最終資産231,889,902円、DD-14.6033%、HYPE12勝6敗。
30bps最終資産129,855,822円、DD-15.8077%、HYPE12勝5敗。
証拠: research/hype-adopted-entry-dual-exit-then-idle-short-20261022 /
HYPE_ADOPTED_ENTRY_DUAL_EXIT_FULL8_20261022.md。

現LIVE独立HYPEは別のH1 EMA12/48 + EMA240 + ブレイクアウトTRENDである。
TREND market-data loaderはBTC/HYPE H1のみを読み、HYPE75研究の因果M5は取得しない。
上記BTを現HYPE TRENDの認証と見なすことは不可能。

本研究ブランチで HYPE75承認済M5入口・出口契約を
lib/hype-trend-adopted-overlay.ts として厳密に実装した。
欠損/時間ギャップ/未確定足/同一足の事後利益保護をfail closedで拒否する。
tests/hype-trend-adopted-overlay-contract.test.ts の15件はPASS。
この関数は現LIVE Runnerに配線しない。経済BTとM5永続状態・venue保護が
未認証のTRENDへ勝手に適用すると誤った約定/利益の主張になる。

## AVAX: 既存8ロジックnative研究済みヘッジ

2026-10-23研究8ロジック、AVAX LONGの-3.5%初回2h監視と
-5% venue hard stop候補は、18採択トレード中の発火0件。
従ってBASE_DUALとWATCH35_2H_PLUS_HARD5の研究経済結果と台帳は全件一致。

10bps: 最終資産268,310,796.4403円、DD-14.514985%、1287取引、
AVAX13勝/18件、台帳SHA256:
415c1011b80eca3f1e91ee928767fe22128c02e7965f967720df784866829b7c。

30bps: 最終資産158,222,977.5297円、DD-15.785695%、1282取引、
AVAX12勝/18件、台帳SHA256:
b0d97988af02fd07841657b4ed85fa67f8c59ea194689cf041e4767a6cf7d360。

一次資料: research/residual-entry-exit-deep-20261023
docs/research/results/residual-composite-20261023/
RESIDUAL_AVAX_WATCH35_HARD5_NATIVE_FULL8_20261023.json
Git blob SHA: 7bd3a0a375cebf48acf12d92ae1d3bd15ceb175f。

初回2h監視の途中回復でタイマーが消える問題の修正は
Codexが現在対応中のPR#295へ組み込み済み。本研究ブランチでは重複変更しない。
履歴発火0件のため急落・滑り・venue STOP fillの実証にはならない。

## 優先発火・Grossと未成立の認証

FET/PENGUは既存の正式エントリー優先のRESIDUAL譲渡経路を持ち、
IDLE+RESIDUALは同一Runner。HYPEの譲渡は独立operatorゲートで制御される。
全8ロジック同時発火/負荷・Gross予約・同時STOP整合性が実取引所で
完全認証されているとは言えない。
共通リスク管理・API再試行・PENGU/HYPEのV4 STOP認識はPR#295で別作業中。

新Q102 ef1ab178... と現TRENDを含む2025-08..2026-08の年間ソース完全一致
統合8ロジックBTには181日Aster-nativeウォームアップが8銘柄で不足している。
そのため旧HYPE75経済BTを現在のLIVEに流用しない。
未復元データを生成して、正規BTがPASSしたことにしない。

LIVE/Production/建玉/STOP/発注/共通リスク/HPはいずれも未変更。
STATUS: HYPE_ADOPTED_M5_CONTRACT_IMPLEMENTED_15_TESTS_PASS;
NOT_WIRED_TO_LIVE; AVAX_OLD_8STRATEGY_ECONOMICS_VERIFIED;
CURRENT_FULL8_NATIVE_CERT_BLOCKED.
