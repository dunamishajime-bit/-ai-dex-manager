# PRISM VII P9 — 同じ確定価格過去から未来だけ分岐する反証実験（結果取得前固定）

研究目的：P8Bでは元source SHORT V20の下落継続32/32勝、下落→急反発2/28勝であり、前者の収益と後者の反発損失を単純な短期下落検出で同時解決できない可能性がある。P8B既見28件ではsqueeze開始H30以前の自然SHORTが22件・そのうち20敗。**時点H<30でのショート候補が、その後の未観測ショックに起因して失敗した可能性を、完全に同一の過去を持つ2つの人工世界で検証する。**

- 2つの世界 `TWIN_DOWN_CONTINUES` と `TWIN_SQUEEZE` は初期264H warmup＋本番評価最初30Hまで **印字の有無、価格、出来高、BTC、PENGU、乱数、H1が1ビットも異ならない**ように生成する。以降72Hのみ分岐。
- 過去25Hなどsource original pinned `1657e173d250ad58f53e62f7bb0a3428fb405496` のENTRY判定関数を一切変えない。二世界の各30H窓で完全一致する自然SHORT候補を全数抽出し、STOP/出口は同じ source pure native `prism7_p8_native_lifecycle_core.mjs` に再生させる。事前に53/53原本パリティ確認必須。
- PENGU/BTCのM5価格生成：264Hは既存P8の中立warmup、その後最初30Hは固定下落ドリフト（PENGU=-0.00030/M5, BTC=-0.00008/M5; PENGU sigma .0035, BTC sigma .0017）。分岐前のレジームは2世界で同一。以降「DOWN継続」はそのまま、「SQUEEZE」はPENGU +0.00042/M5、BTC+0.00015/M5、分岐直後PENGUに+2.5%価格ショック。これは**人工反実仮想**であり実市場のショック確率を推定していない。
- PENGUの取引印字有無はP7の4期間source maskから **固定seed各24本=2026112300〜2026112323、4期間×24=96組の同一連続366H window** を抽出。両世界は同じmask。全体192 path。初期264H＋30H自然ENTRY窓＋72Hのnative EXIT確認窓。期中すべての元候補を残す。mask sourceの終端で不連続に循環接続した際はwrapに記録。
- 正常条件：各組におけるpre-shock H1 OHLCVと原本native entryTs,entryPrice,as-of featuresが**完全一致**、原本SHORT候補数同一。異なる場合はFAIL CLOSED、経済成績を信用しない。分岐後のSTOP価格・出口理由・費用込10/30bps勝敗、同一ENTRYの outcome flipped 数を出す。
- この実験は**同じ過去から異なる未来を構成できる**という反証であり、本番で未来を予測不可能と証明したり、経済的に勝てる入口フィルターを提示するものではない。将来シナリオラベルをENTRY判断に使わない。未見OOS、Funding、実約定、Gross/DD未検証。原状53/53、P8B157/157は変更しない。

不採用の判定を優先する：この人工forkで結果が割れても、事後ラベルで勝った世界だけ選ぶルールは採用不可。新ENTRY/STOP採用には未見実市場と別generator familyでの新独立仮説検証が必要。
