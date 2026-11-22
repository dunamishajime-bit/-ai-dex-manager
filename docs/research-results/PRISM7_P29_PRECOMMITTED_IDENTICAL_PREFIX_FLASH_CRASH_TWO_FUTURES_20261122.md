# PRISM VII P29 — 同じ過去のflash-crashでも未来が違えばCAPITULATION早期利確は有効か（結果前固定）

目的：P25の一度だけ成功した既知2025-10-10 flash-crashに過度に依存していないか反例で壊す。現在のSOURCE S4本番非変更、P25に使ったS3_01700既知source eventのPENGU ENTRY 0.022617、2025-10-10 21:15 UTC M5 CLOSE 0.010000、BTC同時大幅下落、taker買い比率0.0931を全ケース共通とする。未来は2025-10-10 21:20 UTCからのみ生成し、入口・ショック判断の未来情報を変更しない。源 pin 1657e173d250ad58f53e62f7bb0a3428fb405496。

## 固定する未来と印字マスク

人工価格世界はRECOVER_FAST（0.010→0.021USDT、時定数1時間）、CONTINUE_DOWN（0.010→0.004USDT、時定数24時間）、CHOPPY_REBOUND（0.010→0.015USDT、時定数4時間）の3種。すべて生成規則は target + (0.01-target)*exp(-elapsedHours/tau) + amplitude0.008*target*sin(固定seed/time) とし、人工価格系列は一般の市場予測ではない。8独立seed（0..7、random seed 20261122+seed）。5M OPENは前に印字されたCLOSEを保持し、HIGH/LOWはopen/closeの最大最小に±0.2%を機械的に付与。BTC未来は本決済判断の用途外で、元SOURCE 21:15までの同時BTCショックが同一であると明記。

印字マスク3種（FULL_EACH_5M、EVERY_3RD_M5、EVERY_12TH_M5）を結果前固定し、人工未来の21:20から各マスクの正出来高を発生。無印字M5は前正印字CLOSEのOHLCで一定、正印字M5は固定vol100000 PENGU・takerBuy50000 PENGU。72H native参考STOP追跡と最大78H時間切れ保護のsource M5が揃うよう75H以上生成。3未来×8seed×3マスク=72 path。

## 経済比較の厳密な条件

元SOURCE P20参考STOP72（hard +8%、前完成H1低値が15%順行した後に戻り4% trailing、72H期限）を純粋研究価格代理として凍結使用。source元V20のruntime pure phase/exitと同一と主張しない。entry source prefixもP25CAPITULATION検出も全未来で**完全に同じ**、futureが上昇するか下落するかは観測不可。遅延正印字M5 1/2/3本目EXITと、SOURCE STOP時間が先に来る時はnative参考STOP先着（future向きによって早利確許可を都合よく変えない）。10/30bps総費用、extraEXIT滑り0/100/1000bpsを結果前固定。72×3延長×2fee×3滑り=1296価格ケースを全出力。各regime別SOURCE reference勝者の元利益を削ったケース、失敗を救った件数、経済的PnLと印字/停止時間、source winner preservationsを集計。

CONTINUE_DOWNで元REFERENCE_STOP72の下げが続き、CAPITULATION早期利確が元勝ちを削る反例が出れば、そのレジーム自体の出口判断は未来が回復するかは区別できず、P25の1事象改善だけで一般的採用不可と明確に記録。閾値・マスク・seed・scenario数を結果に合わせて変更しない。これは現実の独立OOSではなく人工反実であり、他Runner Gross/PortfolioDD、SIGNED fills・ask depth・Fundingの保証なし。MASTER/Production/VPS/Runner/STOP/注文/建玉/KillSwitch/HYPE不変、Draft PR #595研究だけに保存。
