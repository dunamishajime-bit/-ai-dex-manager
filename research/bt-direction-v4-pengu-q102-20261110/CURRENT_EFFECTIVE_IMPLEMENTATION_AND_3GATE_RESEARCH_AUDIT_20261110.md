# Current Effective Implementation + 3Gate Research Audit — 2026-11-10

## 結論

b1dba30 時点の Production 寄りBTと、その後の764 fills版はいずれも最終基準から外した。
最終基準は current effective runtime の Gross 3.0 / 4.0 / 4.25、Q102 adopted exits ON、FET trailing ON、V52 20bps worst-case dynamic sizing を反映した772 fills版である。

ただし full venue parity ではない。V52 V11 の過去microstructure証拠が不足するため V11 は Fail Closed、V52 V50 は価格proxy、V4 V2候補は retrospective selection、実約定署名がないfillはmodel fillである。

## 最終基準

| Cost | Final MTM | Max DD | Win rate | PF | Closed fills |
|---|---:|---:|---:|---:|---:|
| 10bps | ¥2,280,773 | -46.88% | 61.01% | 1.263 | 772 |
| 30bps | ¥744,900 | -54.68% | 58.29% | 1.201 | 772 |

## Exact 3Gate research

- IDLE JUP: features.rel24 >= -0.04089204262472046
- PENGU Recovery V8: btc24h <= 0.011611625094354983
- Q102 FET: ret14 <= 0.048722800378429465

| Case | 10bps Final | 10 DD | 10 WR | 10 PF | fills | 30bps Final | 30 DD | 30 WR | 30 PF | fills |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Current effective baseline | ¥2,280,773 | -46.88% | 61.01% | 1.263 | 772 | ¥744,900 | -54.68% | 58.29% | 1.201 | 772 |
| IDLE JUP Gate | ¥2,943,937 | -46.88% | 61.25% | 1.318 | 769 | ¥969,550 | -54.07% | 58.52% | 1.245 | 769 |
| PENGU V8 Gate | ¥3,014,167 | -34.07% | 61.41% | 1.336 | 767 | ¥996,775 | -45.97% | 58.67% | 1.260 | 767 |
| Q102 FET Gate | ¥2,327,308 | -47.81% | 61.30% | 1.293 | 770 | ¥787,021 | -52.63% | 58.57% | 1.228 | 770 |
| Exact 3Gate | ¥4,062,029 | -34.54% | 62.02% | 1.467 | 761 | ¥1,368,231 | -44.36% | 59.40% | 1.365 | 761 |

Exact 3Gateの基準比は、10bpsで Final +78.10% / DD +12.33pp / WR +1.01pp / PF +0.204、30bpsで Final +83.68% / DD +10.32pp / WR +1.11pp / PF +0.164。
fillsは 772 → 761 で11件減だけなので、単純な大幅取引削減ではなく、悪い候補の除外と資金競合順序の改善が効いている。

## 現行実装監査で確定した事項

- Effective runtime Gross: Crypto 3.0x / Stock 4.0x / Total 4.25x。別のformal manifestに残る 3.0 / 1.5 / 3.5 とは分離して扱う。
- V52 active source: 8495daf24e53a6cf0dd5e38f022008fa8f78c688。V11/V50 slot 2.0x、20bps worst-case buffer。
- V52 sizingは min(2.0, stockResidual/1.002, totalResidual/1.002) に合わせた。
- Q102 active ef1ab178...: adopted exit policies ON、ACKはactive SHAと一致。
- FET trailing: ON、FET_TRAIL_8P_GIVEBACK_4P。
- HYPE preemption: VPS envで OFF。
- 独立RESIDUALは7-runner manifest対象外のため、旧79件を無理に補完せず除外。
- PENGU active sourceは 1657e173...。7688との差はowner-pin/parity診断中心で、今回の入口/出口経済ロジック差は認めなかった。

## Research Gateの頑健性

### 単独寄与

PENGU V8 GateがDD改善の最大寄与。10bpsでDDを 12.81pp、30bpsで 8.71pp 改善した。
IDLE JUP GateはDD寄与は小さいがFinal/PF改善が大きい。
Q102 FET Gateは30bpsでは改善する一方、10bps DDは 0.93pp悪化しており、3つの中で採用確度は最も低い。

### Train / Validation / Forward

- IDLE JUP rel24: 30bps forward 16件 → Gate後7件、WR 43.75% → 71.43%、PF 0.667 → 3.999。forwardでも方向性を確認。
- PENGU V8 btc24h: train/validationでは明確改善。forwardは4件しかなく全4件がGate通過したため、forwardで悪いものを落とせる証拠はまだない。
- Q102 FET ret14: validationは WR 35.71% → 56.25%、PF 0.401 → 1.082。forwardは WR 53.33% → 57.14%、PF 1.461 → 1.600。改善は小さめ。

### 閾値感応度

- IDLE rel24: -0.05〜-0.03で大幅改善を維持。
- PENGU btc24h: 0.875%〜1.5%でDDはExactとほぼ同水準。2.0%まで緩めるとDDが悪化。
- Q102 FET ret14: 3%〜10%でもExact付近のDD改善を維持。0%はさらに良く見えるが、閾値最適化としては過学習リスクが高いため採用根拠にしない。

## 時間安定性

Exact 3Gateは10bpsで月次リターンが基準より9か月改善 / 3か月悪化、30bpsで8か月改善 / 4か月悪化。
一方で前半6か月の複利は基準より低く、後半6か月で大きく改善している。

- 10bps H1: baseline +4303% / 3Gate +3753%
- 10bps H2: baseline +416% / 3Gate +951%
- 30bps H1: baseline +2492% / 3Gate +2187%
- 30bps H2: baseline +186% / 3Gate +497%

したがって3Gateは全レジームで常に優位ではない。特に2025-10と2026-03は基準より悪化し、改善の中心は2026-05〜06および2026-08〜09である。

## V52 V11欠損への上限感応度

V11は現行実装で有効だが、必要なmicrostructure履歴が不足するため最終基準ではFail Closedを維持する。
別途、既存cacheの34候補をspread/depth/2秒逆行/post-only fill等の実効Gateを無視して全件通す「上限感応度」を実施した。
これはProduction parityではなく、V11欠損が3Gate比較を逆転させるかだけを見るストレスである。

価格包絡監査は250日中possible candidate day 87日だが、真の10:00参照価格レンジ全体で条件を満たすrobust candidate dayは0日だった。
観測LIVE窓17日でもpossible 2日 / robust 0日、実ログはV11 decision 111、candidate non-null 1、position-open 0。
未再現Gateは dataAge、clock差、spread、30秒spread履歴、spread/median、depth、2秒逆行、post-only fill率である。

| V11 upper case | 10bps Final | 10 DD | 10 WR | 10 PF | fills | 30bps Final | 30 DD | 30 WR | 30 PF | fills |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| No research Gate | ¥3,100,950 | -46.88% | 61.56% | 1.275 | 796 | ¥924,547 | -54.65% | 58.42% | 1.210 | 796 |
| Exact 3Gate | ¥5,520,869 | -34.54% | 62.55% | 1.484 | 785 | ¥1,697,731 | -41.60% | 59.49% | 1.379 | 785 |

この極端な上限でも3Gateは10bpsでFinal +78.04% / DD +12.33pp、
30bpsでFinal +83.63% / DD +13.05pp改善した。
したがって、V11をFail Closedにしたことだけが3Gate改善を作っているわけではない。

## 再現性

BaselineとExact 3Gateをそれぞれ再実行し、SUMMARY / FILLS / DECISIONS / EQUITY_30MIN の10/30bps合計8ファイルについて、実行前SHA256 = 実行後SHA256、各8/8一致を確認した。

Machine-readable evidence:
research/bt-direction-v4-pengu-q102-20261110/evidence/VERIFIED_EFFECTIVE_BASELINE_3GATE_AUDIT_20261110.json

## 残る限界

1. V52 V11: current implementationでは有効だが、30秒spread、2秒mid、depth/VWAP等の全期間証拠がない。full-year replayではFail Closed。
2. V52 V50: H1/reference価格proxy。BT期間内に照合可能なactual fillは0件。
3. V4 V2: 過去候補母集団がretrospective selectionであり、実装一致と因果的な研究証明は別。
4. Execution: 多くのfillはmodel fillでsigned venue fillではない。
5. 7-runner前提: このBTは7 Runnerのcurrent implementationを稼働前提で比較する。VPS読取時点で実際にrunningだった取引RunnerはPENGU/Q102/V52。
6. 研究Gate: Production未実装・未デプロイ。

## 判定

- 現行基準BT: これまでで最も current effective implementation に近い厳格証拠版として採用可能。ただし完全実約定一致とは認定しない。
- IDLE JUP Gate: 研究継続価値が高い。forward証拠もある。
- PENGU V8 Gate: DD改善寄与が最大。validationは強いがforward標本4件のため、追加の因果/時系列ストレスが必要。
- Q102 FET Gate: 改善はあるが最もレジーム依存。単独採用より追加検証を優先。
- 3Gate同時: 明確な改善。ただし DD -34.54% / -44.36% はまだ高く、DD改善研究は未完了。Production反映はしない。
