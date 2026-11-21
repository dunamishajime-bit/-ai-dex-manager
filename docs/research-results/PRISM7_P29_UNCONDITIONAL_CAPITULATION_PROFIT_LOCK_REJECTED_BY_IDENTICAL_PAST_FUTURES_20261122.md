# PRISM VII P29 — 72の同一過去・違う未来では、早期CAPITULATION利確が元勝者の利益を削る反例を確認

**判定：P25の単純CAPITULATION直後の無条件EXITは一般LIVE採用不可。** P25のSOURCE自然S4入口S3_01700/21:15 M5 source close0.010000、BTCの同時ショック、SOURCE pinned SHA1657e173d250ad58f53e62f7bb0a3428fb405496を全件共通の過去に固定し、2025-10-10 21:20以後だけ人工的に3未来を生成した。**未来回復/下落というラベルは、当初のCAPITULATION判定が確定した時点には存在しない**ことを強制。

事前登録 `PRISM7_P29_PRECOMMITTED_IDENTICAL_PREFIX_FLASH_CRASH_TWO_FUTURES_20261122.md` に従い、RECOVER_FAST/CONTINUE_DOWN/CHOPPY_REBOUNDの3未来×8固定位相seed×3 positive M5印字マスク=**72人工未来経路**。各々、1/2/3 positive M5 EXIT遅延×fee10/30bps×追加滑り0/100/1000bpsの**1,296価格ケース**を完全記録。全未来の自然源SOURCE entry, shock prefixは全件一致。SOURCE同一 P20 REFERENCE_STOP72はhard8% / 前の完成H1 lowでtrailing activation15%戻り4% / 最大72H。これは本来のpin native V20 exitに完全一致するものではない。SOURCE STOP先行時はREFERENCE STOPを優先する。

## 反例：30bps、追加滑り0、第2positive printで仮想BUY

| 人工未来 | 元REFERENCE STOP72のSHORT参考net | P25無条件CAPITULATION EXIT参考net | 差 |
|---|---:|---:|---:|
| **RECOVER_FAST** | +31.8164% | **+51.6433%** | +19.8269pp |
| **CONTINUE_DOWN** | **+80.7034%** | +55.6201% | **−25.0832pp** |
| CHOPPY_REBOUND | +52.0891% | **+55.0729%** | +2.9838pp |

CONTINUE_DOWNでは**8/8の位相変化seedで元SOURCE勝ちトレードの利益を削る**。参照STOPの勝ちを負けへ変えることはないが、SHORTの長期下落捕捉を25pp以上捨てる。従来P10/P18/P19で「早期EXITが勝者の利益を削る」という同種問題が発生した理由を、過去の同じ市場情報では未来の反発・下落継続を区別できない反実験で確認した。

**人工相場は現実市場の将来データではない**。8種seedは固定位相の感度分析で、8件の統計的に独立した市場標本ではない。見かけの利益率が100%近い人工ケースは人工ターゲット0.004等と72H reference stopだからであり、未来価格の実現を保証するものではない。BTC未来の注文簿や自己署名約定・Funding・他Runner portfolio riskは未再現。P25は既知の2025-10-10shock単独を説明しても将来の下降追随を守る決定器にはなっていない。

## 観測された設計上の不足

元ショック同一prefixの後、反発しても下落継続しても即時EXITを選ぶ規則は**将来結果を識別できない**。必要な別状態は、CAPITULATION_CONFIRMED→待機→**その後に初めて確定するM5価格とBTC価格の回復情報で買い戻し回復を確認**→次のpositive M5 openでEXITするという複数段の因果構造。今後P30で仮説検証する場合も今回P29の人工結果を見た後に新ルールを作った事実を隠さず、さらに未見の別価格生成/市場へ持ち込んで反例を探すこと。SOURCE H1 natural候補/Source 120setupを削らない。

## 証跡

- `scripts/research/prism7_p29_identical_past_two_opposite_shock_futures_20261122.py`（元source同一prefix、source純REFERENCE STOP72でfutureのみ反事実）
- `scripts/research/test_prism7_p29_identical_prefix_72_artificial_futures_20261122.py` **5/5 PASS**
- `docs/research-results/prism-phase2-20261122/PRISM7_P29_72_IDENTICAL_PREFIX_FUTURES_SUMMARY_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P29_1296_SYNTHETIC_OUTCOME_LEDGER_20261122.csv`
- original P25 source SHA固定、全72過去一致、前提のstamp/入出口費用/STOP時刻のpreemptionを明示。通常SOURCE pin/PENGU V2/Recovery V8/本番Runner/STOP/建玉/実注文は未変更。

**PENGU全体勝率80%・実口座Portfolio DD20%は未達。P25/P28は研究に留める。**
