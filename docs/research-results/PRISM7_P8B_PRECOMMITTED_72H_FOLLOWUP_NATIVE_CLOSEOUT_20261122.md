# PRISM VII P8B — P8と同じ157自然SHORTの独立決済追跡（実行前事前登録）

**研究限定・Production不変更。P8人工84?訂正：固定SHAネイティブ384経路336Hから157自然SHORT候補・86モデル決済・71終了時打切りを観測済み。P8で出た15勝/86（17.44%）は打切り選択バイアスを含むので、実運用勝率/完全BTと呼ばない。**

同じ157候補を厳密に追跡し、元sourceの最大保有72時間がすべて経過するよう **264Hウォームアップ＋72H自然入口発火窓＋72H追加の出口観測＝408H**。追加72H中に発生した新しいSHORT候補は分母へ追加しない。既存P8コードを経済ロジックを変更せずコピーして更新する。

1. 旧P8と同じseed値・profile・regime・価格RNG・**最初336HのH1/M5**を1本も変えない。既存P8 384 PATHSのmask start indexと57? 実際は**157全SHORTの自然ENTRY時刻/価格**が一致するまでFAIL CLOSED。既存86のnative exit reason/time/priceも全件一致するまでFAIL CLOSED。
2. 追加72Hは、既存source maskのその後の連続5分足印字有無を読み、人工価格regimeを固定ルールで延長する。抽出した336H窓がsource末尾に近い**20/384経路**では、末尾到達時に印字maskだけを元ファイル先頭から循環接続する（**人工的な継ぎ目**でありリアルな継続流動性と称しない）。wrap pathとnon-wrapの経済結果を**全件別々に報告**し、影響を隠さない。PENGU価格は循環させない。
3. EXITは元の固定 `1657e173d250ad58f53e62f7bb0a3428fb405496` のSTOP/決済純関数のまま。hard/trailing stopはSOURCE resident STOP価格モデルであり、取引所注文板の実約定ではない。
4. 成績は**自然SHORT157件を母集団**として10bps/30bps、完了/打切り、勝ち、平均損益、PF、hard STOP、価格負担、入口時H1印字欠損を別々に表示。source H1 openで実約定した保証はゼロ、無取引H1/印字遅延を実約定成功と数えない。
5. 不変検査：ソース53/53入口＋EXIT parity、P8 157/157候補entry matching、既存86/86 EXIT matching、prefix-no-futureテスト、384 paths、72H追加で全元候補のEXITが観測できるか。合格しても**元PENGU80%を満たす取引ルールではない**。未見データ、現実の約定・funding・DD/Shared Grossは依然未証明。
6. 全行台帳、SHA256、コード、wrap sensitivity、テストをDraft PR #595の研究ブランチのみへ保存。master/VPS/本番Runner/STOP/建玉/実注文不変更。
