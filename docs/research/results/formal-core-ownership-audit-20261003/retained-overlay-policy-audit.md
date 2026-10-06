# Retained Production Idle / DOGE / AVAX policy recovery

Source: Production `53eeff5417636369d4709fddfd47d7916ddcf3b1` を保持した runtime candidate `1ad60851b65e185ffd9b54511145a822201625f8` の既存 Overlay コード。推測による再設計なし。

## Idle SHORT

Source: `config/idlePriorityShortPolicy.ts`, `lib/idle-priority-short-signal.ts`, `lib/idle-priority-short-idle-gate.ts`, `lib/idle-priority-short-baseline-admission.ts`。

- Core V12/PENGU/Q102/FET/V52 の実建玉/pending なし、current H1 の baseline candidate evidence が全て fresh かつ eligible baseline signal なし。
- baseline evidence は必ずしも filled entry だけでなく、V12 `SIGNAL_AVAILABLE` / Q102 selected eligible / PENGU targetGross>0 / FET candidate / V52 accepted を使用。この差を accepted-trade schedule で置換してはいけない。
- 他 sidecar exposure / 非Core pending はBLOCK。actual Crypto cap3 / Total4.25にfull1xが入る時だけ。部分発注なし。
- Generic candidate の12h symbol lifecycle を baseline idle 時に進め、BREAKOUT→RELATIVE→MOMENTUM を優先。LONGや採用対象外SHORTを含むgeneric lifecycle消費と、実際のIdle fill occupancyは別。
- TAO BREAKOUT SHORT relative24h<=-2% / hold12h。
- TIA BREAKDOWN SHORT volumeRatio<=100 / hold24h。
- DOT MOMENTUM SHORT BTC24h<=0 / relative24h<=0 / hold24h。
- JUP / RENDER RELATIVE SHORT / hold12h。
- generic feature は確定H1、prior72 volume median、prior24 highs/lows、ATR14。future close/target_net は入場判断に使わない。
- Gross1、5xCross、stop10%/TP25%、full hold exit。same-symbol Idle 同時保有禁止。
- 複数symbol候補は policy順 TAO/TIA/DOT/JUP/RENDER。全候補分の余地がない場合に ambiguous batch を一括BLOCKする実装を単純な勝率順selectionへ置き換えない。
- 後発CoreのためのIdle SHORT preemptionは認めない。

## DOGE / AVAX LONG residual

Source: `config/idleResidualLongPolicy.ts`, `lib/idle-residual-long-signal.ts`, `lib/idle-residual-long-preemption.ts` と各Core runnerのcallsite。

- DOGE relative24h>=3% / volume>=1.2 / ATR>=0.7%、priority1。
- AVAX relative24h>=3% / volume>=0.8 / ATR>=0.7%、priority2。
- 二つで **共有1position**。DOGE/AVAX同時保有ではない。
- Core flat/pendingなし/current eligibleなし、さらにIdle SHORT position/pending/current signalなし。未管理exposureなし、actual full1x capacityあり。
- Gross1、5xCross、LONG、stop10%/TP25%、hold12h。
- Core/Idleをpreemptして入場しない。CoreにはRank3も含まれる。
- 後発Core新規entryは `releaseIdleResidualLongForFormalEntry` により whole residualをreduce-only解放し、fresh account/positions/quoteへ戻る。単なる不足時half-releaseではない。
- residual保有中のCore/Idle priorityは `FORMAL_PRIORITY` / `IDLE_SHORT_PRIORITY` exit。source snapshot invalidを安全側priorityとして処理する既存経路もあり、正常なno-signalと混同しない。

## 優先順位 / tie-break / ownership

優先関係は Core (Rank3を含む) > Idle SHORT > residual LONG (DOGE > AVAX)。Rank3には新Formalの同timestamp上位signal拒否・後発上位への譲渡が追加される。

Formal modelのCore同timestamp順序は V52→PENGU→V12→Q102→FET。実LIVEの別systemd daemonに対し、このglobal tie-breakが常に実現することまで今回のread-only監査では証明していない。account lockが相互排他であることと、全strategyの決定論的順序は同じ証明ではない。

特にCore exact台帳自体に15組のsame-symbol所有権競合が発見されたため、5構成のLIVE-equivalent認証は未実施。shadow stateの追加やactual ownership gate迂回で数値を合わせない。
