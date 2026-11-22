# PRISM VII P26 — M5 HIGH不利ストレスの「同じ足の終値の未来ピーク」依存を取り除く、時間順監査（結果前固定）

SOURCE P20/P21/P22/P23及びP25`PENGU_S4_CAPITULATION_CAPTURE_V1`のすべてのentry/exit model時刻、元SOURCE状態、費用・候補120件を変更せず、異常価格下の未実現DDを**時間順の観測可能情報だけで再計算**する純粋な研究監査。

問題：従来P23の`maximumM5HighAdverseEnvelopeDDPct`は同じ5Mバーの `CLOSE`から未実現NAV最高値を更新した**後**に、そのバーのHIGHで不利側DDを評価する。単一M5内ではそのHIGHは必ずバー終値より前なので、「まだ存在しないCLOSEピークを知った後に過去のHIGHを経験した」という非因果な順序を取り得る。これはP23が定義した**保守的なstress envelope**であり本番現実DDではないと既に注記されているが、数値解釈と採用判定を明確にする必要がある。

## 結果より前に固定する独立時間順のmetric

1. 各M5 OPENの直前までに確定している `runningPeakNAV`（既に確定した先行M5 CLOSEによる未実現markとrealized exit cashのみ）を保存し、**現在M5のHIGH時の仮想悪化NAVをこの`peakBeforeBar`と比較**する。`HIGH`と同一M5の`CLOSE`を先後逆転させない。続いてそのM5のCLOSEを評価し `runningPeakNAV`を更新。M5 within-bar low→highの順序不明は依然残り、これを「真の最大DD」と呼ばない。
2. `SOURCE exit M5 bar OPEN`で決済済みとモデル化される場合、そのM5内のHIGHは**EXIT後に発生した可能性があり**、SOURCE比較用の現時点STRESSには加えない。実注文/stop fillではなくsource modelの先行清算イベントを優先。
3. `entry M5 bar OPEN`でSHORT代理entryした場合、足内HIGHはpositionの保有中に発生可能として先行確定ピークとの比較対象。ただし実際のOPEN約定可否は確認できない。
4. 毎時SOURCE feeは10bps/30bpsでentry+exit両側合計。ポジション1倍、初期1万円。保有中close marked NAV、right-censored final NAV、既存reference P23 M5 close DDは**完全一致**が必要。P23は既存のrisk modelとして保存し、今の時間順HIGH解釈だけ別指標 `maximumPrevBarPeakCausalHighAdverseDDPct` を追加する。SOURCE P23 legacy `maximumM5HighAdverseEnvelopeDDPct`を上書きしたり都合よく「消去」しない。
5. ケース群：SOURCE V20 referenceの1slot、P20 S3の1slot、P21 S3Confirmの1slot、P22 S4の1slot、P25 S4_CAPITULATION主案（30bps/第2正印字M5/extra0）、およびP25追加1000bps、3print delay等固定済み研究シナリオ。30bpsに加え10bpsもレポート。P25が全120setupを保持していることとP23既存DD比較を確認。
6. SOURCE M5 positive print candle完了にのみMARK更新し、volume0は前のpositive print CLOSEをcarry forward（実市場で約定可能という意味はない）。position entry/exit時刻のorder event証明なし。新ルール導入・STOP変更・建玉改変なし。
7. P25は**既知の1 flash-crashから条件設定しており、歴史市場での同一期間成績は独立OOSではない**。高値ストレスの修正でDDが20%以下に見えても、close mark / source gross / actual fills / synthetic squeeze / 未見OOSが不足すれば採用できない。
8. GitHub Draft PR #595研究のみでコード/台帳/固定SHA/回帰を保存。master/VPS/Runner/実注文/STOP/建玉/HYPE/KillSwitch変更しない。

この監査は前のrisk計算の透明性を上げるのが目的であり、SHORT方向予測勝率80%への改善を偽装するものではない。
