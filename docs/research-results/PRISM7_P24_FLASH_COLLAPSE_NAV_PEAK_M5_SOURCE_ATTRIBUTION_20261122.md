# PRISM VII P24 — S4のDD35.94%の発生源は一時的に巨大化した含み益。翌時間足の価格反発と別日建玉を分離

**計算と元SOURCEのM5/H1台帳から確認済み。研究のみ、Production不変更。** P22 `PENGU_S4_FAILED_REBOUND_V1`（元source自然V20 SHA `1657e173d250ad58f53e62f7bb0a3428fb405496` は比較のみで不変更）に対し、P23のpositive M5 close NAV全時点・EXIT価格・右打切り1件を元台帳だけから独立に再構成。P23の最大DDと最終評価額に**完全一致**した。

## 独立したピーク→谷の確定した時系列

| ソース時刻 UTC | 元トレードID | 価格状態 | 参考評価額1万円起点 | 意味 |
|---|---|---|---:|---|
| 2025-10-10 **21:15** | `S3_01700` | SHORT entry代理 PENGU **0.022617 USDT** | その時点の確定現金10,767.31円 | 発火から印字ENTRYまで待つP22モデル |
| 2025-10-10 **21:20** | `S3_01700` | PENGU M5終値 **0.009588 USDT** | **16,937.75円** | 主要なポートフォリオ最高水準。ただし含み益、未約定。 |
| 2025-10-10 21:35 | `S3_01700` | PENGU M5高値0.022982 USDT | **10,561.25円**（M5-high adverse stress） | 同日の極端な買い戻し反発で含み益が失われた |
| 2025-10-10 **22:00** | `S3_01700` | SOURCE reference trailing exit **0.020007 USDT** | 確定後 **11,977.56円** | 利益を全て失ったわけではないが、モデルの最大含み益は捕捉していない |
| 2025-10-31 **01:25** | `S3_02173` | PENGU M5 CLOSE **0.019098 USDT** | **10,850.07円** | 過去最高未実現ピークとの差が**35.94150% DD**。この取引自身は後に+7.27%のsource参考利益で72H時限EXIT |
| モデル終了まで | S4の最終右打切り建玉1件 | 未決済SOURCE positive M5 final closeで評価 | **25,557.32円** | 確定済み21取引だけのNAV 25,847.77円とは別 |

10月10日以前の最初のS4取引 `S3_01348` はsource参考hard STOPで−8.3%、続く `S3_01634` は約+17.42%。最大DDのピーク16,937.75円は**実現済み資金でなく、10月10日のshockによるM5 closeベースの含み益**。P23の実現済みDD16.10175%と、含み益をピークに含む35.94150%が大きく異なる根本理由はここにある。

## 元価格データの相互確認

Aster public PENGU H1 2025-10-10 21:00UTC は `OPEN 0.025487 HIGH 0.026158 LOW 0.006241 CLOSE 0.020073`、元5分足のLOW/HIGH/CLOSEは矛盾なし。PENGU 21:15の5分足は `OPEN0.022617 HIGH0.023038 LOW0.010000 CLOSE0.010000 VOL1,363,556 PENGU`、21:20足は `OPEN0.006241 HIGH0.009588 LOW0.006241 CLOSE0.009588 VOL211,606 PENGU`。21:25足は `OPEN0.010100 CLOSE0.013801`、21:35足は `HIGH0.022982`。BTC同時source 21:15は `CLOSE104694.7`、21:20は `CLOSE108355.0`、H1 21:00 は `LOW101500`。**PENGU・BTCの複数時間軸で同じ時間帯の急落・反発が整合**し、単純な1本のOHLC記録壊れだけでは説明できない。しかし異なる取引所の板・ASK/queue・署名約定の検証ではない。

**高値ストレスDD37.64670%**は原P23仕様の「M5足内のhighをworst adverse可能値として計算」。M5内で高値と終値の前後順序は観測不可で、実際のトレードのマーク損益や逆指値市場注文ではない。

## 再現性

- 事前登録 `PRISM7_P24_PRECOMMITTED_S4_M5_DD_PEAK_TROUGH_ATTRIBUTION_20261122.md`。
- ソース解析 `scripts/research/prism7_p24_s4_source_m5_peak_trough_attribution_20261122.py`
- 回帰 `scripts/research/test_prism7_p24_independent_m5_peak_trough_attribution_20261122.py` **6/6 PASS**。S4 22建玉（21決済、1右打切り）、元P23の M5 mark DD35.9415034787、高値stress DD37.6467027557、最終NAV25,557.31687円と完全一致。
- source SHA・原120/元P22比較 `docs/research-results/prism-phase2-20261122/PRISM7_P24_S4_M5_DD_PEAK_TROUGH_SUMMARY_20261122.json`
- 全22保有中経路と入出口・最善価格・最悪価格・時点ピーク `docs/research-results/prism-phase2-20261122/PRISM7_P24_S4_M5_DD_22_POSITION_LEDGER_20261122.json`。

**判断：P22の勝率71.43%、PF3.906という構造設計の部分改善は認めるが、含み益ピークの失効でDD上限20%未達。** 入力価格の時間順と執行可能性を失わないよう、次はP25でBTCも連動して暴落し、PENGU M5の売り成約が極端に優勢という**別のCAPITULATION状態**で全元候補と手数料・流動性ストレスを検証する。ショック後都合よく高値で買い戻したことにはしない。

**LIVE/master/VPS/Runner/建玉/STOP/KillSwitch/HYPE未変更、研究Draft PR #595のみ保存。**
