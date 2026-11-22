# PRISM VII P28 — 入口予測と保有リスクを分離したLayer3機会配分：資本倍率0.75/1.0/1.25の固定反証（経済結果前固定）

P27ではP25残存M5DD21.958773%の谷S3_10500が利益SHORTで、その過去ピークはS3_07302の未実現勝ち益だったと分かった。単純に「DD谷を生んだトレードを除外」して元勝ちを破壊することを禁じる。従来のP10/P18/P19のEXITゲートは元勝ち利益を著しく削ったため不採用。本研究P28は**新ENTRY/EXIT判定を一切変更せず、Layer3のgross資金配分だけを独立な恒等分解**で試す。目的はDD20%以内の設計可能性の検証であり、PENGU勝率80%を達成したという意味ではない。

対象はS4 `PENGU_S4_FAILED_REBOUND_V1` Source H1構造120setup・単一枠、P25 `PENGU_S4_CAPITULATION_CAPTURE_V1` 原本source自然120件・実価格代理21決済/15勝+右打切り1件。比較基準はP25 30bps・第2positive M5/extra0・gross1.0x=平均net+7.01950%、PF5.13405、M5 closeDD21.95877%、前M5まで確定peakに対するHIGH stressDD21.95877%。すべてSOURCEイベントとSTOP参照を改変せず元SOURCE2事件を保存。

## 先に固定するgross候補

**0.75x / 1.0x / 1.25x の3つだけ**。SOURCE P25既存の1/2/3 positive M5 exit delay×追加exit slip0/25/100/500/1000bps×手数料10/30bps×3 gross=**90条件**。個別ロジック・相場・通貨・既知取引の結果に合わせてgrossを変えない。再最適化なし。入口母集団/正解方向判断条件/stop trigger/約定代理時刻は全部同一。

- 初期10,000円、1slot、各ENTRYごとに `notionalFraction=0.75/1.0/1.25 × entry時点直前のequity`。数量代理 `fraction×equity/entryPrice`、SHORT M5 price変動損益はfraction倍、両側合計fee10/30bpsは**notionalに対して**fraction倍、extra exit slippageはP25 source exit price代理 `M5positiveOpen×(1+slipBps/10000)` へ反映済みでfraction倍。毎ENTRY時のgrossは固定倍率でも複利に伴い絶対数量が変わる（JPYとUSDTの換算や実注文の lot/rounding は別、交換約定可能と主張しない）。
- EXIT M5 open reference priceで清算し、SOURCE STOP先着原ルールを変更しない。未決済1件はSOURCE M5終端の最終正出来高CLOSEで評価して架空決済しない。
- SOURCE 5M mark NAV `cash×[1+gross×(entryPrice-mark)/entryPrice−gross×feeBps/10000]` を時間順で更新。前完了M5 peak/現在M5 HIGH stressを計測し、同一M5の未来CLOSEをHIGH前に使用しない。P23/26旧1x（gross1.0）結果と完全一致しなければFailClosed。
- 90条件×取引22=1,980建玉単位のentry/exit/notional/NAV/本来勝ち保護台帳を保存。総120 setupの採否、21トレード/15勝、右打切り1は**倍率で変えない**。
- 比較にはSOURCE native元V20本来のportfolio grossや他Runnerの3.0/3.5制約、Shared daily loss7.5%や真のportfolio maxDD21% Kill Switchは含まれない。この研究で **gross0.75ならDD20%になっても、それをProductionの認証と呼ばない**。
- 再現できない異常OHLCまたはSOURCE 1x P25 M5close DD21.958773/参考NAV約35,621.1円から差があればFailedClosed。コスト/倍率の影響と通常の勝率が固定のままである点を必ず明記。

P28の結果が良くても、P25は**2025-10-10既知ショックだけで組み立てたCAPITULATION例外**で真の未見OOS証明がなく、取引所注文・ask book・funding・他Runner Gross/DDも未再現。本番移行や既存Runnerのサイズ変更・発注を一切実施せず、GitHub PR #595研究Draftへコード・結果・SHAのみPush。
