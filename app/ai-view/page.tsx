import {
  buildAiViewDocument,
  type AiViewDocument,
  type AiViewStatusToken,
} from "@/lib/server/ai-view";
import {
  loadLivePortfolioSnapshot,
  unavailablePublicPortfolio,
  toPublicPortfolioSummary,
} from "@/lib/server/live-portfolio";
import { loadDecisionStatusSurface } from "@/lib/server/disdex-observability-surface";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export const metadata = {
  title: "AI View | DisDex",
  robots: { index: false, follow: false, noarchive: true },
};

const statusClass: Record<AiViewStatusToken, string> = {
  PASS: "status-pass",
  FAIL: "status-fail",
  WAIT: "status-wait",
  BLOCKED: "status-blocked",
  UNKNOWN: "status-unknown",
};

function Status({ value }: { value: AiViewStatusToken }) {
  return <span className={statusClass[value]}>{value}</span>;
}

function value(value: unknown) {
  return value === null || value === undefined || value === "" ? "UNKNOWN" : String(value);
}

function time(value: string | undefined) {
  if (!value || value === "UNKNOWN") return "UNKNOWN";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "UNKNOWN";
}

function Steps({ steps }: { steps: AiViewDocument["v12"]["steps"] }) {
  return <ul className="ai-view-list">{steps.length ? steps.map((step, index) => <li key={`${step.label}-${index}`}><Status value={step.state} /> <strong>{step.label}</strong> — {step.detail}</li>) : <li><Status value="UNKNOWN" /> 実行経路のstepは未取得です。</li>}</ul>;
}

function AiViewDocumentPage({ document }: { document: AiViewDocument }) {
  return <main className="ai-view-shell">
    <header className="ai-view-header">
      <p className="ai-view-kicker">DISTerminal / SERVER GENERATED READ-ONLY VIEW</p>
      <h1>DisDex ChatGPT確認用HTMLページ</h1>
      <p>JavaScript不要のSSR確認経路です。通常UIと同じserver observability surfaceから取得した公開安全情報だけを表示します。</p>
    </header>

    <section className="ai-view-card" aria-labelledby="system-status">
      <h2 id="system-status">SYSTEM STATUS</h2>
      <dl className="ai-view-grid">
        <div><dt>System</dt><dd><Status value={document.system.state} /> {document.system.status}</dd></div>
        <div><dt>checkedAt</dt><dd>{time(document.checkedAt)}</dd></div>
        <div><dt>source</dt><dd>{document.source}</dd></div>
        <div><dt>readOnly</dt><dd>true</dd></div>
        <div><dt>tradingMutation</dt><dd>tradingMutation=0</dd></div>
        <div><dt>System detail</dt><dd>{document.system.detail}</dd></div>
      </dl>
    </section>

    <section className="ai-view-card" aria-labelledby="runtime-status">
      <h2 id="runtime-status">ACTIVE LOGICS / RUNTIME STATUS</h2>
      <div className="ai-view-table-wrap"><table><thead><tr><th>Strategy</th><th>Runtime</th><th>ACTIVE</th><th>State</th><th>Stage</th><th>Observed</th><th>Blocker / detail</th></tr></thead><tbody>{document.strategies.map((strategy) => <tr key={strategy.id}><th scope="row">{strategy.label} ({strategy.id})</th><td>{strategy.runtimeStatus}</td><td>{strategy.runtimeStatus === "LIVE" ? "ACTIVE" : "INACTIVE"}</td><td><Status value={strategy.state} /></td><td>{strategy.stage}</td><td>{value(strategy.observedCandidates)}</td><td>{strategy.blocker || strategy.detail}</td></tr>)}</tbody></table></div>
    </section>

    <section className="ai-view-card" aria-labelledby="attention">
      <h2 id="attention">CURRENT DECISIONS / ENTRY PATH</h2>
      {document.attention.length ? <ul className="ai-view-list">{document.attention.map((item, index) => <li key={`${item.strategyId}-${item.symbol}-${index}`}><Status value={item.state} /> <strong>{item.strategyId} {item.symbol} {item.side}</strong> / stage={item.stage} / rank={value(item.rank)} — {item.blocker || item.detail}</li>)}</ul> : <p><Status value="UNKNOWN" /> 現在の候補・判定は未取得です。</p>}
    </section>

    <section className="ai-view-card" aria-labelledby="v12">
      <h2 id="v12">V12 X1.00 ALL / 2H DECISION</h2>
      <dl className="ai-view-grid">
        <div><dt>Selected</dt><dd>{document.v12.selected.symbol} / {document.v12.selected.side}</dd></div>
        <div><dt>Rank / score</dt><dd>{value(document.v12.selected.rank)} / {value(document.v12.selected.score)}</dd></div>
        <div><dt>momentum / volumeRatio</dt><dd>{value(document.v12.selected.momentum)} / {value(document.v12.selected.volumeRatio)}</dd></div>
        <div><dt>BTC regime</dt><dd>{document.v12.selected.btcRegime}</dd></div>
        <div><dt>Signal Gate</dt><dd><Status value={document.v12.selected.gate} /> {document.v12.selected.reason}</dd></div>
      </dl>
      <h3>Execution steps</h3>
      <Steps steps={document.v12.steps} />
      <h3>All candidates / rank comparison</h3>
      {document.v12.candidates.length ? <div className="ai-view-table-wrap"><table><thead><tr><th>Rank</th><th>Symbol</th><th>Side</th><th>Score</th><th>Momentum</th><th>VolumeRatio</th><th>BTC regime</th><th>Gate</th><th>Reason</th></tr></thead><tbody>{document.v12.candidates.map((candidate, index) => <tr key={`${candidate.symbol}-${index}`}><td>{value(candidate.rank)}</td><td>{candidate.symbol}</td><td>{candidate.side}</td><td>{value(candidate.score)}</td><td>{value(candidate.momentum)}</td><td>{value(candidate.volumeRatio)}</td><td>{candidate.btcRegime}</td><td><Status value={candidate.gate} /></td><td>{candidate.reason}</td></tr>)}</tbody></table></div> : <p><Status value="UNKNOWN" /> V12候補snapshot未取得です。</p>}
    </section>

    <section className="ai-view-card" aria-labelledby="pengu">
      <h2 id="pengu">PENGU DUAL LS V2 / SHORT V20</h2>
      <dl className="ai-view-grid">
        <div><dt>Runtime</dt><dd>{document.pengu.runtimeStatus} / <Status value={document.pengu.state} /></dd></div>
        <div><dt>Stage</dt><dd>{document.pengu.stage}</dd></div>
        <div><dt>Latest completed H1</dt><dd>{time(document.pengu.latestReference)}</dd></div>
        <div><dt>Long</dt><dd><Status value={document.pengu.long.state} /> {document.pengu.long.detail}</dd></div>
        <div><dt>Short</dt><dd><Status value={document.pengu.short.state} /> {document.pengu.short.detail}</dd></div>
        <div><dt>Failures</dt><dd>{document.pengu.failureCount} active / {document.pengu.resolvedFailureCount} resolved</dd></div>
      </dl>
      <p>{document.pengu.detail}</p>
      <h3>Execution steps</h3>
      <Steps steps={document.pengu.steps} />
      {document.pengu.features.length ? <><h3>Safe features</h3><ul className="ai-view-list">{document.pengu.features.map((feature) => <li key={feature.key}>{feature.key}={feature.value}</li>)}</ul></> : <p><Status value="UNKNOWN" /> PENGU feature snapshot未取得です。</p>}
      {document.pengu.failureReasons.length ? <><h3>Fail-closed reasons</h3><ul className="ai-view-list">{document.pengu.failureReasons.map((reason, index) => <li key={`${reason}-${index}`}><Status value="BLOCKED" /> {reason}</li>)}</ul></> : <p><Status value="PASS" /> active failureなし</p>}
    </section>

    <section className="ai-view-card" aria-labelledby="v52">
      <h2 id="v52">V52 TOP2 / ASTER-ONLY</h2>
      <dl className="ai-view-grid">
        <div><dt>Runtime</dt><dd>{document.v52.runtimeStatus} / <Status value={document.v52.state} /></dd></div>
        <div><dt>Reference</dt><dd>{document.v52.referenceStatus} / <Status value={document.v52.referenceGate} /></dd></div>
        <div><dt>Reference reason</dt><dd>{document.v52.referenceReason}</dd></div>
        <div><dt>Kill Switch</dt><dd><Status value={document.v52.killSwitch} /></dd></div>
      </dl>
      {document.v52.windows.map((window) => <article className="ai-view-subcard" key={window.window}><h3>{window.window} NY window</h3><p>entered={String(window.entered)} / capture={String(window.capture)} / retry={window.retryCount}</p><h4>Candidates</h4>{window.candidates.length ? <ul className="ai-view-list">{window.candidates.map((candidate, index) => <li key={`${candidate.symbol}-${index}`}>Rank {value(candidate.rank)} / {candidate.symbol} / basisBps={value(candidate.basisBps)}</li>)}</ul> : <p><Status value="UNKNOWN" /> candidate snapshot未取得です。</p>}<h4>Entry / rejection decisions</h4>{window.decisions.length ? <ul className="ai-view-list">{window.decisions.map((decision, index) => <li key={`${decision.symbol}-${index}`}><Status value={decision.state} /> Rank {value(decision.rank)} / {decision.symbol} — {decision.detail}</li>)}</ul> : <p><Status value="WAIT" /> 発注判断記録なし</p>}</article>)}
      {document.v52.errors.length ? <ul className="ai-view-list">{document.v52.errors.map((error, index) => <li key={`${error}-${index}`}><Status value="FAIL" /> {error}</li>)}</ul> : null}
    </section>

    <section className="ai-view-card" aria-labelledby="portfolio">
      <h2 id="portfolio">MANAGED POSITIONS / OPEN ORDERS (PUBLIC SAFE SUMMARY)</h2>
      <dl className="ai-view-grid">
        <div><dt>Portfolio status</dt><dd>{document.portfolio.status}</dd></div>
        <div><dt>Captured</dt><dd>{time(document.portfolio.capturedAt)}</dd></div>
        <div><dt>Managed/open positions</dt><dd>{value(document.portfolio.positionCount)}</dd></div>
        <div><dt>Open orders</dt><dd>{value(document.portfolio.openOrderCount)}</dd></div>
        <div><dt>Protected orders</dt><dd>{value(document.portfolio.protectedOrderCount)}</dd></div>
      </dl>
      {document.portfolio.positions.length ? <ul className="ai-view-list">{document.portfolio.positions.map((position) => <li key={`${position.symbol}-${position.side}`}><Status value="PASS" /> {position.symbol} / {position.side} / protection={position.protected ? "YES" : "NO"}</li>)}</ul> : <p><Status value="UNKNOWN" /> 公開安全な建玉明細はありません。</p>}
    </section>

    <footer className="ai-view-footer"><strong>Status vocabulary:</strong> {document.statusVocabulary.map((item) => <Status key={item} value={item} />)}<br />readOnly=true / tradingMutation=0。 このページは読み取り専用です。注文・取消・決済・建玉変更は行いません。</footer>
  </main>;
}

export default async function AiViewPage() {
  try {
    const surface = await loadDecisionStatusSurface();
    let portfolio = unavailablePublicPortfolio();
    try {
      portfolio = toPublicPortfolioSummary(await loadLivePortfolioSnapshot());
    } catch {
      portfolio = unavailablePublicPortfolio("DATA ERROR");
    }
    return <AiViewDocumentPage document={buildAiViewDocument(surface, portfolio)} />;
  } catch {
    return <main className="ai-view-shell"><header className="ai-view-header"><p className="ai-view-kicker">DISTerminal / FAIL CLOSED</p><h1>DisDex ChatGPT確認用HTMLページ</h1><p>SYSTEM STATUS: <Status value="FAIL" /> DATA ERROR</p><p>判定surfaceを取得できないため、実稼働を推測表示していません。</p><dl className="ai-view-grid"><div><dt>readOnly</dt><dd>true</dd></div><div><dt>tradingMutation</dt><dd>0</dd></div><div><dt>source</dt><dd>UNKNOWN</dd></div></dl></header></main>;
  }
}
