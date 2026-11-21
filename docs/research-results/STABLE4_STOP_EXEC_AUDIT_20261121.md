# STABLE4 既存損切りのBT実行監査 2026-11-21

結論：BTでのSTOP実行不整合は存在する。研究限定の最小修正で既存初期STOPをM5で先行実行することはできたが、Productionとの経済一致とDD20%達成は未証明。

## 対象
- 2025-10-01 00:00 UTC〜2026-10-01 00:00 UTC（終端除外）、初期資金1万円、複利、10bpsと30bpsは独立。
- H48ベースとGross条件変更21.57%ケース、およびSTOPモデル優先・V52 EXIT分離の計6研究ケース×2コスト＝12本。
- 各105,121点のMTM資産推移、約定数、最大DD、最終資産、勝率、PFを独立再計算し12本PASS。
- ここでいうSTOPはモデル内の価格バリア。実取引所のSTOP・約定数量・レイテンシー・スリッページの証拠ではない。

## 初期STOP到達より先に決済できていないモデル取引
|Runner|Gross21.57% 10bps|30bps|具体例|
|---|---:|---:|---|
|V4|14|14|ADA SHORTで8%逆行バリア到達後さらに15時間45分保有、最大逆行約19.67%|
|PENGU|5|5|Recovery V8の6%STOPが4件、LONG V64の8%STOPが1件、10〜50分遅延|
|Q102|2|2|ARB/SUI HIGH_VOLの10%STOPが10〜55分遅延|
|FET|0|0|8件の採用取引に初期STOPの先行バリア矛盾なし|
|IDLE|0|0|34〜35件の採用取引に初期STOPの先行バリア矛盾なし|

STOPの時間差検出は、エントリーからモデル出口までの確定5分OHLC高安を列挙し、基準STOPに最初に触れた足とBTモデル出口を比較。途中の反転とV4 ATR/native動的出口、V52 basis STOP、HYPEの別48h研究モデルには一律バリアを当てず未判定としている。

## V52のEXITまで日次損失ラッチで停止される
- 研究コードの条件は if not v52_latched and v52_session_open(t) であり、新規STOPと既存EXITを分離できていない。
- 7件で本来のEXITが延期。最大331時間。NVDA LONGは2026-02-26 18:30 UTC予定が2026-03-12 13:30 UTCまで残り、2026-03-09の口座最大DDに重なった。
- うちTSLA LONGは2026-02-03 17:30 UTC予定のBASIS_STOPが2026-02-04 14:30 UTCまで21時間延期。損切り命令そのものの延期を確認。
- 現行VPS Productionに同じ遅延があると断定していない。対象は研究BT。

## 未稼働か未検証かを区別
- PENGU SHORT V20は元40候補中、3時間後2.5%逆行で4候補、8時間後4%逆行で2候補、重複を除く5候補が閾値に該当。ただしその5候補は統合BTで一件も採用されず、約定後の早期損切り実行を確認できない。
- Q102 PB LONGの1.5%早期逆行EXITは元5候補で存在したが統合BTで採用0件。HIGH_VOL LONGの3%×H1二本条件の1件は共有リスクが先に全決済。
- Q102 HIGH_VOLでは前半M5ファイル必須の読込ロジックに問題があり、後半M5が存在しても19候補が欠損扱い。suffixのみの検証版で5件の早期STOP候補を訂正、9候補は価格未取得期間につき未解決。
- HYPE研究H48R4は7件が48時間時刻EXIT、1件が優先度EXITで、独立のATR価格STOP実行を証明しない。HYPEのLIVE設定は変更していない。
- FETは8採用モデル取引中5件にFET_PROTECTED_STOP、IDLEは34〜35採用取引中3件にIDLE_HARD_STOPを確認。

## 既存STOPだけを修復した統合BT再計算（手数料モデル別）
|研究ケース|最大DD 10bps|最大DD 30bps|終端資産10bps|終端資産30bps|
|---|---:|---:|---:|---:|
|Gross21.57% 元モデル|21.5712%|22.2816%|¥13,541,227|¥4,923,412|
|初期STOPを5分足で優先|21.6406%|22.3509%|¥11,344,054|¥4,184,956|
|5分STOP＋V52 EXIT分離|24.8408%|21.3415%|¥23,079,035|¥4,005,248|

- 既存STOPを優先してもDD20%未達。エントリー可能枠・複利資本・次の発火が変わり、DDは単調には減らない。
- 修正ケースでは初期STOPが先に触れたのに5分以上後でモデルEXITするケースは0件に。Q102各費用モデル3取引はM5不足で判定不能、全件PASSとはしない。
- 未使用データでのOOS、現行Production経済パリティ、注文/STOPの実取引所証拠は未検証。

## 次の修正タスク
1. 現行Productionの固定SHAと正確なSTOP設置・変更・約定イベントを照合し、研究エンジンの出口に同等の処理を実装。
2. V52の既存建玉EXITを日次新規停止から完全分離。損失ゲート中もSTOP保護が残ることをCIで確認。
3. Q102の欠損M5を実取得し、HIGH_VOLのSTOP優先・同足TP競合・事後価格誤差を検査。
4. PENGU SHORT V20の時間別逆行STOPを反実仮想でなく、採用エントリーを含むテストと本番pin呼び出し経路で検証。
5. 各経路のLIVE実装一致・10bps/30bps・DD20%以下・独立walk-forward・人工相場を通過して初めて本番採用検討。

## 保存証跡
- STABLE4_STOP_EXEC_AUDIT_EVIDENCE_20261121.json: 21取引、V52 7件、PENGU条件、元/修正の要約。
- STOP_AUDIT_INDEPENDENT_MANIFEST.json: 12本の全資産系列・約定とSHA256再計算。
- audit_m5_stop_barriers.py: 5分足STOPバリア監査。
- audit_corrected_stop_portfolio_replay_with_suffix.py: モデル内最小STOP修復＋V52 EXIT分離（本番非反映）。
- audit_corrected_m5_fill_barriers.py: 修正後の先行バリア反証テスト。
- validate_stop_replay_independent.py: 12本の独立再計算。

状態：RESEARCH_ONLY / MODEL_STOP_TIMING_ANOMALY_CONFIRMED / 12_RECALC_PASS / DD20_NOT_MET / LIVE_UNCHANGED
