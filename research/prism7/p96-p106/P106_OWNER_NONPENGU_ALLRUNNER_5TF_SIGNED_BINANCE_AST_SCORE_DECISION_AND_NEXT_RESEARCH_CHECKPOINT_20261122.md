# P106 最終チェックポイント｜全Runner（V52除外）ASTER＋Binance 5時間足 signed point・全口座BT（2026-11-22）

## Owner依頼の解釈と実施範囲
- 指示：PENGU以外の全ロジックへWeekly/Daily/12H/4H/1Hの事前トレンド採点を加え、V52以外の全ロジックにBinance判断を併用し、PENGUで実施したような誤判定・全体DD改善余地を研究する。
- 既存PENGU SHORT V20 Owner採用仕様（Binance Native V20発火→ASTER確定M5ゲート→ASTER注文候補、GrossはP73相当）を保持。PENGU他ルートも変えない。V52は点数対象外。
- **今回のBinance利用は、ASTERで元Nativeロジックが発火した候補に対する、Binanceの非未来参照の5時間足『確認/減点』。V4/Q102/IDLE/HYPE/FET等の元nativeロジック自体をBinance価格へ移植して独立発火させた実験ではない。** それは別途各Pinned原関数・出口を再現してから比較する必要がある。
- 研究専用。MASTER、LIVE、Runner、STOP、Kill Switch、実発注、Grossや建玉の本番状態はいずれも未変更。

## Binance公式のデータ調達
- 2025-07〜2026-09、追加21銘柄のBinance Futures USD-M 1H、**315月次ZIP全件**を公式公開SHA256チェックサムとCSV OHLCV・時刻連続性でPASS。先行P70のPENGU/BTC/ETH 165アーカイブも使用。
- Aster既存ソースとそれぞれの確定済み時間足（W 月曜UTC開始、D、12H、4H、1H）を独立に集計し、将来の未確定足は使用しない。
- ASTER方向一致点：±5/±4/±3/±2/±1；Binance方向一致点：±3/±2/±2/±1/±1。LONG UP、SHORT DOWNで正、逆なら負。2回連続の確定終値方向が必要。ASTER/BinanceのW逆行−3、D逆行−2、BTC/ETHマクロ逆行−3、未知は0またはW/D未確定なら当該ゲートFail-Closed。PENGU以外の元Native入口・出口価格・ロットは一切改変せず、入口見送りの効果を検証。
- 元モデル信号2715件（V4 1394/Q102 205/IDLE183/FET11/HYPE78/補助728/PENGU116 shadow）、V52は別建玉モデルとして維持。

## 全Runner5分刻み統合BT（過去1年／10bps・30bps）
- モデル：2026-11-09 旧STRICT_V2研究シミュレーターに基づくP92ベース。PENGU Owner選定のBinance→ASTER確定M5をP91実相場41→P73 33→M5通過4のNative Aster source replayとして投入。全て5m時刻刻み、Crypto Gross3.0／Stock1.5／Total3.5、V52モデルGross1.5、日次損失7.5%、初期1万円複利。実約定・現行STABLE4実装との完全一致ではない。
- 30bps基準（PENGU新方式のみ、他未変更）：**最終NAV 551,075円、最大DD29.95%、約定857、勝率60.68%**。
- 6種類の一律ゲート（ASTER0以上/Binance0以上/双方0以上/緩い点数/リスク付き点数/厳しい点数）の全てで利益・DDが基準より悪化。特にBinance0以上を全体適用した30bps：**NAV333,476円、DD35.27%**。
- 9系統・ルート別適用ではIDLEのみ：NAV540,142円/DD26.22%、Q102 BRK/PBのみ：550,918円/DD28.57%、補助のみ：558,418円/DD29.95%。V4全体、Q102全体、HYPE全体等は悪化。
- 4組み合わせで見かけ上最も有望だった **IDLE + Q102 BRK/PB + 補助限定のBinance非マイナス判定**：30bps NAV607,456円、DD23.17%、約定832、勝率60.34%。基準比NAV+10.23%、DD−6.78pp。10bps NAV1,893,662円/DD21.12%（対基準1,807,111円/DD24.62%）。**10/30bpsいずれも目標DD20%未達**。
- その3系統方式の同期間月次改善5、悪化6、同等1。30bpsで従来拒否→新許可33、従来許可→新拒否58。年間で恣意的に良いルートを選別した結果を独立OOSとは呼ばない。

## P102–P105 ランダム同数見送り反証
- 有望3系統の候補966のうち、AST/Binance点数が理由で見送る**218件**を固定。各strategy+route+symbol+side内の見送り数を正確に保持したまま、候補割当を決定論的乱数でシャッフルした**32パターン**を、同一PENGU入口・5m統合資金管理・10/30bpsで全再計算。
- 30bpsのランダム対照中央値NAV417,594円、DD31.71%；実際のBinance選別方式NAV607,456円、DD23.17%の方が良い。ただし対照**#28**がNAV683,218円・DD21.77%で、**利益・DDとも実際のBinanceスコア方式を凌駕**。10bpsでも対照#28が両指標で凌駕。
- ランダム割当は事後の非取引可能な反証であり、スコア優位性の検定そのものではない。32回のうち1回が上回った事実は「損切り誤判定改善の因果的証明」との判断を拒否する根拠となる。さらに完全独立の実市場OOS未実施。

## 次の研究タスク
1. 旧研究版ではなく現行STABLE4、H48、各Runnerの本番固定SHA、Shared Risk Daily7.5%、DD21% HOLD／復旧、V52、Gross上限などを最新コードと照合。**まず新旧変更ゼロのBT原結果完全一致PASS**。先行版で拒否されていたDD21ゲート由来673件の新たな再許可は、この旧モデルでは検証不可。
2. V4逆張り、Q102 MR/REVとBRK/PB、IDLE各通貨、HYPE、FET、補助を別々の構造・相場局面として検証。5時間足スコアをまずShadow観測にし、通貨/方向ごとの勝敗、反発、低流動性、トレンドに逆行した勝ちの消失を集計。
3. 研究期間より前の2025年以前など完全未使用の実相場／新規人工相場・独立Binance Native発火（原ロジックが当該Binance OHLCVで再計算可能な場合のみ）で、複数取引所の独立判定に本当の利得があるか確認。ASTER現物の約定価格・元EXIT/STOPを維持、Binance価格はASTERの約定としない。注：公開データ取得期間不足、暗号化・手数料/スリッページの現実乖離を明示。
4. 10/30bps、買戻し追加100bps、M5-high DD、Funding、約定・STOPギャップ、Runner占有／再許可件数を再検証。DD20%以内、勝率・利益の現実妥当性、複数独立局面での改善が揃うまでLIVE／正式稼働条件変更はしない。

## 再現物

- 研究総合：`research/prism7/p96-p101/P96_P101_NONV52_ALLRUNNER_5TF_AST_BINANCE_SIGNED_POINTS_FLEET_BACKTEST_REPORT_20261122.md`
- 32反証：`research/prism7/p102-p104/P102_P104_NONV52_BINANCE_FIVE_TF_POINT_SCORE_VS_32_ROUTE_MATCHED_RANDOM_VETOS_20261122.md`
- P101本体＆SHA：`research/prism7/p103/P103_P101_19_ALLRUNNER_PORTFOLIO_MODELS_FULL_EVIDENCE_20261122.zip.b64`
- P97全2715ポイント台帳：`research/prism7/p103/P103_P97_2715_NATIVE_ASOF_W_D_12H_4H_1H_BINANCE_ASTER_SCORES_20261122.zip.b64`
- 32シャッフルマスク・P104監査：`research/prism7/p105/P105_ALL32_ROUTE_MATCHED_RANDOM_VETO_MASKS_AND_FLEET_10_30BPS_FALSIFICATION_20261122.zip.b64`
- 30bps複合の約定・Funding・拒否：`research/prism7/p103/P103_SELECTED_TRIPLE_30BPS_ALL_RUNNER_FULL_FILLS_FUNDING_DECISION_TAPE_20261122.zip.b64`
- 10bps複合：`research/prism7/p103/P103_SELECTED_TRIPLE_10BPS_ALL_RUNNER_FULL_FILLS_FUNDING_DECISION_TAPE_20261122.zip.b64`

**最終状態：`BINANCE_H1_SOURCES_315_PASS | NONV52_W_D_12_4_1_SIGNED_SCORE_2715_PASS | UNIFORM_6_REJECT | SELECTIVE_P100_RESEARCH_ONLY | RANDOM_VETO_32_FALSIFICATION_PASS | TARGET_DD20_FAIL | CURRENT_STABLE4_PARITY_PENDING | PRODUCTION_UNCHANGED`**
