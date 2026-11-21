# P21 preregistered — S3の「構造発見」と「実際に売り優勢が成立する時点」を別状態へ分離

**研究のみ。元SOURCE V20本番/Runnerには触れない。** P20新独立 `PENGU_S3_STRUCTURE_V1` 120候補/元SOURCE V20原本53候補・P20共通REFERENCE_STOP72のコードと結果を固定。P20 S3単一slotは53件価格代理完了・25勝・PF1.084、SOURCE53は33完了17勝PF1.560。P20 RouteBの個別候補PF1.447だが一枠下ではPF1.101へ崩れた。これは入口の「相場構造を検知した時刻」と「売りが再開したという実際の市場印字時刻」を同一視している問題が疑われる。

**P21の別名:** `PENGU_S3_CONFIRM_V1`（研究用）。P20の三入口構造の各しきい値を変更せず、全120構造セットアップを残す。過去勝敗を入口へ使用せず、保有中のnative STOPを優先した P20 と同じ REFERENCE_STOP72を利用。構造候補自体を削除しない。

## 新しいM5イベントの状態機械

`STRUCTURE_SEEN`：P20確定H1 tでS3 A/B/Cのどれかが成立し、その足の`low`、`close`を固定。次H1開始の`intentTs=t+1H`を`PENDING_SELLER_CONFIRMATION`開始とする。M5正出来高がない時間は注文しない。新規待機のTTLは**2H（24本M5）**で固定し、複数候補が重なっても候補を1つずつ保持し現時刻の未来を見ることは禁止。

`SELLER_CONFIRMATION`：M5 tのcloseが確定した時点のみ、次の要件をすべて満たす：
1. `PENGU M5 close <= previousCompletedSignalH1Low×(1−0.002)`：既知H1の安値を0.2%以上さらに下抜いた。
2. 直近**3本の正出来高M5**がM5時刻で最大35分幅以内、出来高加重の `takerBuyVolume/totalVolume<=0.42`（買いよりも売りの成約が優勢）。
3. 現在M5 close<=前の正出来高M5 close（悪化している方向を確認）。
この3条件は売り出来高・価格両方の確認であり、SOURCE当初のEMA/H1単純多数決ゲートとは異なる。ただし3連続印字M5の値を将来で補うことは禁止。現在M5のclose確定時刻は`t+5min`。

`ENTRY_REQUEST`：SELLER_CONFIRMATIONしたM5の**次以降**の初回正出来高M5 OPENにSHORT代理注文が成立したと仮定する。ただし `print openTs >= confirmedM5start + 5min` かつ `openTs<setupIntentTs+2H`。当該時刻までに印字が無ければ `EXPIRED_NO_ENTRY_PRINT`。途中で強い買い反転が見えても自由裁量で期間を延ばしたり下落後に遡った約定をしない。

`POSITION_LIVE`：ENTRY代理以降はP20と**同一 `REFERENCE_STOP72`**（hard +8%、前H1までの低値で15%好方向後 trailing4%、最大72H・最初のM5正印字でtime exit）。M5内STOP高値/次H1openの時刻と価格に先読みなし。SOURCE-native本来のSTOPと同値と主張しない。

`ONE_SLOT_ADMISSION`：全候補の売り成立を独立に推定し、その後実際のproxy-entry timestamp順に1枠へ投入。枠を利用中に別候補のproxy-entryがあれば `OCCUPIED_SLOT` で元candidate数120の分母に残す。初期構造120中、売り確認のないsetup、TTL失効、枠塞ぎ、未観測を**勝ち取引とは数えない**。最初のM5の引けを予め知ってその足の始値約定にする因果違反を禁止。

## 比較の定義

SOURCE53原本もP20のS3単純ENTRY（REFERENCE_STOP72同一）も、既に保存したP20全候補と完全照合（同じ120 ID・H1 as-of feature・価格印字/元stop）。P21が数を減らしただけの見かけの高勝率なら不合格。**all setups120母集団基準の勝ち利益・失敗利益、採用機会数、複利参考DD（未実現/他runner等を含まない）**も必ず出す。10bps/30bps + 追加滑り0/10/25bps、各ルートPRE/BASE/POSTを個別記録。

- P21研究で既見歴史の候補120と元53のnative winsは既知。P21の成績を再び同じ市場で改善したからといって独立OOSと称しない。
- 人工市場に対する、同一過去の売り加速 vs 買いSQUEEZE、M5無印字、BTC divergenceへの反証、および完全独立未見期間を通るまで採用しない。
- PENGU V2/Recovery V8/HYPEとProduction master/VPS/Runner/KillSwitch/STOP/実注文/建玉は不変更。研究用Draft PR #595のみ保存。
