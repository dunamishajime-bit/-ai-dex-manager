# PRISM VII P9: 同一の過去→下落継続/急反発に分岐する人工世界 (2026-11-22)

**研究状態：P9 完了。源native SHORT V20純関数をそのまま使用、事前固定したfork96組×2=192経路、源自然SHORT13組=26経路取引、全26 native EXIT完了。実運用への採用や変更はしない。**

## 目的と前提

P8Bの既見人工384経路では元固定SHAの自然 SHORT V20 157件が77勝(49.045%)、30bps平均+2.595%、PF1.677。特に人工市場「下落→急反発」28件のうち2勝（反発前発火22件中2勝、反発後発火6件中0勝）だった。**発火前に将来の人工ショックが観測可能なのか**という識別可能性を、future leakageのない反実仮想で確かめる。

実験コード・SEED・合格条件は観測前に `PRISM7_P9_PRECOMMITTED_IDENTICAL_PREFIX_FORK_20261122.md` へPush済み。元runtime SHA `1657e173d250ad58f53e62f7bb0a3428fb405496`。元53件の自然ENTRY/EXITパリティとsource-native共有出口関数53/53 PASSを前提にした。同じ取引印字maskと**人工価格の乱数系列**を使い、264h warmup＋30h SHORT ENTRY発火窓までは完全同一のH1、30h到達時に未来のみ分岐、その後72hは二つの人工市場でEXITまで追う。

- TWIN_DOWN_CONTINUES: 30h以降PENGU下落ドリフト-0.00030/5m, BTC-0.00008/5m継続。
- TWIN_SQUEEZE: 30h以降PENGU上昇ドリフト+0.00042/5m, BTC+0.00015/5m。fork直後+2.5%人工ショック。
- 4取引印字mask profile×24seed（2026112300〜2026112323）=96共通過去ペア、**192経路**。取引印字有無は源履歴のみ、価格は人工生成で実市場のデータではない。

## 厳格な再現証拠

- 共通過去のPENGU/BTC H1 OHLCV・時間・出来高・印字maskのSHA256 **96/96ペア一致**、元native pure signalも各ペア同一。
- 自然SHORT **13ペア**だけ発火（それ以外の共通過去83組には自然SHORTなし）。その13ペアではentryTs、entryPrice、原raw features（ATR24、BTC、RSI、volume等）の完全一致。source STOP/出口の経済関数は二世界で同一。
- 13×2=26件の元source native STOP/EXIT **全26件完了、未決済0**。
- 30bps人工native価格モデルでは、**下落継続11勝/13（84.615%）**、**急反発3勝/13（23.077%）**。同じENTRY13ペアのうち**8件**が下落世界の勝ちから急反発世界の負けへ転換、逆転は0件、残5件は勝敗符号変わらず。いずれも**入口時点の利用可能な過去は完全同一**。二世界は独立の市場の取引ではなく、因果反証である。
- P9全経路の集計26取引・14勝（両未来を足した補助指標）は、二世界で同一ENTRYを二重カウントするため**通常の戦略勝率として評価してはならない**。

## 重要な結論

下落前の源自然SHORT候補だけから**未観測の2.5%反発ショックの有無を完全判別することは不可能**。同じas-of入力に同じ入口フィルタを当てれば、二つの世界で同じ決定となる。したがって、元shortの勝ちをなるべく維持しながらsqueezeでの大幅損失を減らすなら、**エントリー後の新しい価格・BTC・出来高観測による保護**、約定可能性を含む本物のSTOP/EXIT順序、リスク上限を統合して検証する必要がある。

ただし、これは全ての実相場で80%が不可能という主張ではない。人工価格ショックの発生確率や分布は現実の母集団を代表せず、利益モデルも resident STOP の指値約定可能性/滑りを証明していない。**後付けで急反発世界の取引を削って勝率改善したと数えるのは禁止**。この研究の目標は損失の因果分解と新しい保護機構の反証。

## 再現性と証跡

- source P8Bから派生する固定版 `scripts/research/prism7_p9_derive_source_pinned_twin_fork_20261122.py` と `prism7_p9_native_identical_prefix_twin_replay.mjs`。sourceピン変化時はFail Closed。
- 96グループ・13ペア比較を独立に検算する `test_prism7_p9_native_identical_prefix_fork_20261122.py` **5/5 PASS**（入口特徴量、源H1完全一致、STOP/EXIT完了、8勝敗flip、費用差、非実約定の表示）。
- 出力summary／全26case ledger／192path ledger／13pair ledgerをGitHub保存。別再実行のSHA256が4証跡すべて完全一致。
  - summary `41041088253047ec5164b6a6a09b37e480e937c01d1155258c636797cfaaa640`
  - 26 cases `39832176d7eec9bc84cfd5bdf1bfa31768c2b34ae458cad9a243d1df796d7ee3`
  - 192 paths `86cb799af46a99be70bec3f73c30eec6d9b270a459f22538fc4357820c7be58b`
  - 13 twin pairs `c3c3cd851112fb670f3b43f20db49c8c14cae888798d7c72253aab64b9a2a629`
- 96組中、自然短期ENTRYが出た組だけが13組。少数かつsynthetic特性のため実績推定としては標本不足。

## 次の検証 P10

1. 同じ固定source pure SHORT入口/STOPを維持したまま、**今のH1までの保有後観測**を使った保護EXITのみ、事前に具体的な事実ベースで候補登録する。FUTURE_LABEL/人工ショック開始時刻は条件に使わない。方向が当たったnative勝ちのP&Lを維持する必要がある。
2. 新EXITは元native EXITと**同一時刻に競合する場合、nativeのSTOP執行を優先**する（恣意的に勝ちを作らない）。as-of signalと次H1観測可能なopenで仮想決済し、印字なしopenを実約定と宣言しない。
3. 元実市場53、人工P8B157件、ペア13件×2の全件で、実際に勝ちが負ける件数／負けが勝ちに変わる件数、平均PnL、PF、取引数、STOP/価格印字不整合を同時測定する。過去で結果を見た後の閾値調整は禁止。
4. 未見OOS、source H1/M5不一致、実注文キュー、Funding・Risk/Gross/Portfolio DD<=20%は別ゲート。達成していない。

**本番マージ・VPS/Runner・建玉・STOP・HYPE・Kill Switch変更なし。PR #595 Draft研究専用。**
