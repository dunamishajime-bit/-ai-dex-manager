# PRISM VII P23 — S4/S3/SOURCEの固定M5時間順「未実現+実現」マークDDゲート（計算結果前固定）

**研究用、実口座やProduction DDの推定値を保証しない。** P22の1枠30bps SOURCE 120 setups→21件完了/15勝/平均+4.93363%/PF3.906、**実現済みのみDD16.101754%**。しかしP22は`RIGHT_CENSORED`の建玉1件を含む。既存源SOURCE53/新S3 P20/P21を同一SOURCE Aster M5参照による未実現マークも含むDD基準へ付け替える必要がある。本研究より前に以下を固定し結果に基づく救済的ルール変更を禁止。

1. 比較群は `SOURCE53_SINGLE_SLOT`（元P20 source自然53を共通REFERENCE_STOP72と同じ印字で検証）、`S3_SINGLE_SLOT`（P20）、`S3_CONFIRM_SINGLE_SLOT`（P21）、`S4_SINGLE_SLOT`（P22）の4群。元source native SHORT V20の本来のEXITは再現していない旨を保持。候補元数(53/120)・元の状態分類（OCCUPIED/未印字/未確認/右打切り）と各ENTRY/EXIT timestamp/priceは**変更しない**。
2. 10,000円初期資金、ポジション1枠・建玉想定元資金の1.0x、**SHORTエントリー時の単位固定qty=前のモデル現金残高/entryProxyPrice**。SOURCEモデル通りのnet価格損益は `gross=1-exitPrice/entryPrice`。10bps/30bps両側合計費用を入口/出口に半額ずつ発生したと仮定。未来の出口費用も保有中NAVから概算で控除してマーク。
3. ENTRY proxy M5 openからEXIT proxy M5 open/STOP価格まで、正出来高M5の**確定CLOSE**でunrealized NAVを評価。zero-print M5の最新価格は前の正印字CLOSEから持ち越し `STALE_NO_PRINT_MARK` とし、取引可能な価格とは称さない。**EXITのM5バーはCLOSEが出た時刻にまだ建玉があるとは仮定せず、元出口model priceで清算し、そのバーのHIGHは別の強制stress envelopeへ記録**。
4. 同時に、各保有正出来高M5のHIGHでSHORT最大逆行損益を計測して `HIGH_ADVERSE_ENVELOPE` DDを別に出す。特にSOURCE resident STOP M5内の高値がSTOP発火後だった可能性があるため、このHIGH envelopeは**保守的なイントラバー順序不明のストレス値**であって観測済み現実NAVではない。
5. 右打切り建玉があればEXITを架空生成しない。M5原資料の終了`2026-11-18T00:00Z`以前の正印字最終CLOSEでunrealized NAVを表示し、**開いているポジションとして残す**。元の実現DD16.1%にはこれが未含有なので、必ずDDの差と右打切り1件を報告する。もし最終マークが欠損/無印字ならFail Closed。
6. 計算に使う時点のSOURCE public Aster M5 OHLCVはSHA固定・正出来高足のみ。M5内high/lowとentry/exit先後、spread/ASK/quote/partialFill/stop order signed evidence/funding/otherRunner Grossを再現できない。実口座の最大DD上限21%やdaily loss7.5%の厳密運用判定は主張しない。
7. 各群について10/30bps＋追加出口滑り0/10/25bps、`realizedOnlyDD`、`M5CloseMarkDD`、`HIGH_ADVERSE_ENVELOPE_DD`、STALE最大連続無印字、RIGHT_CENSOREDカウント、最終口座評価額を比較。**どちらかがDD>20%でも設計採用条件は未達**。強い条件付勝率を口実に値を隠さない。
8. 各本来の取引ID・route・entry/exitと保有中のworst high/M5 drawdown根拠時刻を台帳に残し、全候補は捨てず、バックテストsource prefix invarianceを尊重。PR #595 Draft研究以外へPushせずProduction Runner/STOP/注文/HYPE等を触らない。

P23は既見データで、独立未見OOSではない。実口座portfolio DD20%を認証するにはvenue signed fill / other runner / gross/account snapshots/market funding/mark to market long-shortの別照合が必要。
